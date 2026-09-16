/** Ticket writes and reads. */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ticketItemModifiers, ticketItems, tickets } from '../db/schema.js';
import { assertTotalsMatch, recomputeTicket } from './pricing.js';
import { badRequest, conflict, notFound, unprocessable } from '../utils/errors.js';
import type {
  CreateTicketBody,
  ListTicketsResponse,
  PayTicketBody,
  TicketDto,
  TicketSummaryDto,
} from '../types/index.js';

/** Row shape returned by the ticket-detail query, before timestamp normalisation. */
type TicketRow = Omit<TicketDto, 'createdAt'> & { createdAt: Date | string };

const TICKET_SELECT = sql`
  SELECT
    t.id,
    t.status,
    t.subtotal_cents         AS "subtotalCents",
    t.tax_cents              AS "taxCents",
    t.total_cents            AS "totalCents",
    t.payment_method         AS "paymentMethod",
    t.amount_tendered_cents  AS "amountTenderedCents",
    t.change_due_cents       AS "changeDueCents",
    t.created_at             AS "createdAt",
    COALESCE(it.items, '[]'::json) AS items
  FROM tickets t
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'id',             ti.id,
               'productId',      ti.product_id,
               'productName',    ti.product_name,
               'quantity',       ti.quantity,
               'unitPriceCents', ti.unit_price_cents,
               'lineTotalCents', ti.line_total_cents,
               'modifiers',      COALESCE(m.modifiers, '[]'::json)
             )
             ORDER BY ti.sort_order
           ) AS items
    FROM ticket_items ti
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'name',            tim.modifier_option_name,
                 'groupName',       tim.modifier_group_name,
                 'priceDeltaCents', tim.price_delta_cents
               )
               ORDER BY tim.sort_order
             ) AS modifiers
      FROM ticket_item_modifiers tim
      WHERE tim.ticket_item_id = ti.id
    ) m ON TRUE
    WHERE ti.ticket_id = t.id
  ) it ON TRUE
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function getTicketById(db: Database, id: string): Promise<TicketDto> {
  const result = await db.execute<TicketRow>(sql`${TICKET_SELECT} WHERE t.id = ${id}`);
  const row = result.rows[0];
  if (!row) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`, { ticketId: id });
  return { ...row, createdAt: toIso(row.createdAt) };
}

export async function createTicket(db: Database, body: CreateTicketBody): Promise<TicketDto> {
  const computed = await recomputeTicket(db, body.items);
  assertTotalsMatch(computed, body);

  const ticketId = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        status: 'open',
        subtotalCents: computed.subtotalCents,
        taxCents: computed.taxCents,
        totalCents: computed.totalCents,
      })
      .returning({ id: tickets.id });

    if (!ticket) throw new Error('Ticket insert returned no row');

    const insertedItems = await tx
      .insert(ticketItems)
      .values(
        computed.items.map((item, index) => ({
          ticketId: ticket.id,
          productId: item.productId,
          productName: item.productName,
          productPriceCents: item.productPriceCents,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          sortOrder: index,
        })),
      )
      .returning({ id: ticketItems.id, sortOrder: ticketItems.sortOrder });

    // Map by sortOrder rather than trusting RETURNING to preserve input order.
    const itemIdBySortOrder = new Map(insertedItems.map((r) => [r.sortOrder, r.id]));

    const modifierRows = computed.items.flatMap((item, index) => {
      const ticketItemId = itemIdBySortOrder.get(index);
      if (!ticketItemId) throw new Error(`Missing inserted ticket item for index ${index}`);
      return item.modifiers.map((modifier, modifierIndex) => ({
        ticketItemId,
        modifierOptionId: modifier.optionId,
        modifierGroupName: modifier.groupName,
        modifierOptionName: modifier.optionName,
        priceDeltaCents: modifier.priceDeltaCents,
        sortOrder: modifierIndex,
      }));
    });

    if (modifierRows.length > 0) {
      await tx.insert(ticketItemModifiers).values(modifierRows);
    }

    return ticket.id;
  });

  return getTicketById(db, ticketId);
}

export async function payTicket(
  db: Database,
  id: string,
  body: PayTicketBody,
): Promise<TicketDto> {
  if (body.paymentMethod !== 'cash') {
    throw badRequest(
      'UNSUPPORTED_PAYMENT_METHOD',
      `Payment method "${body.paymentMethod}" is not supported yet. Only cash is accepted.`,
      { paymentMethod: body.paymentMethod },
    );
  }

  const existing = await db.execute<{ status: string; totalCents: number }>(sql`
    SELECT status, total_cents AS "totalCents" FROM tickets WHERE id = ${id}
  `);
  const ticket = existing.rows[0];
  if (!ticket) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`, { ticketId: id });

  if (ticket.status !== 'open') {
    throw conflict('TICKET_NOT_OPEN', `Ticket is already ${ticket.status}`, {
      ticketId: id,
      status: ticket.status,
    });
  }

  if (body.amountTenderedCents < ticket.totalCents) {
    throw unprocessable('INSUFFICIENT_TENDER', 'Tendered amount does not cover total', {
      totalCents: ticket.totalCents,
      amountTenderedCents: body.amountTenderedCents,
    });
  }

  const changeDueCents = body.amountTenderedCents - ticket.totalCents;

  // Compare-and-set: two concurrent payments cannot both win.
  const updated = await db.execute<{ id: string }>(sql`
    UPDATE tickets
       SET status                = 'paid',
           payment_method        = ${body.paymentMethod},
           amount_tendered_cents = ${body.amountTenderedCents},
           change_due_cents      = ${changeDueCents},
           paid_at               = now()
     WHERE id = ${id} AND status = 'open'
    RETURNING id
  `);

  if (updated.rows.length === 0) {
    throw conflict('TICKET_NOT_OPEN', 'Ticket was already paid or voided', { ticketId: id });
  }

  return getTicketById(db, id);
}

export async function listTickets(
  db: Database,
  limit: number,
  offset: number,
): Promise<ListTicketsResponse> {
  const result = await db.execute<TicketSummaryDto & { createdAt: Date | string; totalCount: number }>(sql`
    SELECT
      t.id,
      t.status,
      t.total_cents AS "totalCents",
      t.created_at  AS "createdAt",
      COALESCE(ic.item_count, 0)::int AS "itemCount",
      count(*) OVER()::int            AS "totalCount"
    FROM tickets t
    LEFT JOIN LATERAL (
      SELECT SUM(ti.quantity)::int AS item_count
      FROM ticket_items ti
      WHERE ti.ticket_id = t.id
    ) ic ON TRUE
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const rows = result.rows;

  // The window function cannot report a total when the page itself is empty
  // (e.g. an offset past the end), so fall back to a plain count.
  let total: number;
  if (rows.length > 0) {
    total = rows[0]!.totalCount;
  } else {
    const countResult = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM tickets`,
    );
    total = countResult.rows[0]?.count ?? 0;
  }

  return {
    tickets: rows.map(({ totalCount: _totalCount, ...row }) => ({
      ...row,
      createdAt: toIso(row.createdAt),
    })),
    total,
  };
}
