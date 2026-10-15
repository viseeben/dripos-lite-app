/** Ticket writes and reads. */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ticketItemModifiers, ticketItems, ticketPayments, tickets } from '../db/schema.js';
import { assertTotalsMatch, recomputeTicket } from './pricing.js';
import { applyTenderCents } from '../utils/money.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
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
    t.client_ticket_id       AS "clientTicketId",
    COALESCE(pay.payments, '[]'::json)              AS payments,
    COALESCE(pay.applied, 0)::int                   AS "amountPaidCents",
    (t.total_cents - COALESCE(pay.applied, 0))::int AS "amountRemainingCents",
    -- A sale taken offline happened before it reached us; show when it happened.
    COALESCE(t.placed_at, t.created_at) AS "createdAt",
    COALESCE(it.items, '[]'::json) AS items
  FROM tickets t
  LEFT JOIN LATERAL (
    SELECT
      json_agg(
        json_build_object(
          'id',                  tp.id,
          'sequence',            tp.sequence,
          'paymentMethod',       tp.payment_method,
          'amountTenderedCents', tp.amount_tendered_cents,
          'amountAppliedCents',  tp.amount_applied_cents,
          'changeDueCents',      tp.change_due_cents,
          'createdAt', to_char(tp.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        ORDER BY tp.sequence
      ) AS payments,
      SUM(tp.amount_applied_cents) AS applied
    FROM ticket_payments tp
    WHERE tp.ticket_id = t.id
  ) pay ON TRUE
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

/**
 * Postgres unique-violation (23505). Two devices syncing the same sale race here.
 * Drizzle wraps driver errors in DrizzleQueryError, so the pg code sits on
 * `.cause` rather than the error itself; walk the chain rather than assume depth.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function findByClientTicketId(
  db: Database,
  clientTicketId: string,
): Promise<TicketDto | undefined> {
  const result = await db.execute<TicketRow>(
    sql`${TICKET_SELECT} WHERE t.client_ticket_id = ${clientTicketId}`,
  );
  const row = result.rows[0];
  return row ? { ...row, createdAt: toIso(row.createdAt) } : undefined;
}

export async function getTicketById(db: Database, id: string): Promise<TicketDto> {
  const result = await db.execute<TicketRow>(sql`${TICKET_SELECT} WHERE t.id = ${id}`);
  const row = result.rows[0];
  if (!row) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`, { ticketId: id });
  return { ...row, createdAt: toIso(row.createdAt) };
}

export async function createTicket(db: Database, body: CreateTicketBody): Promise<TicketDto> {
  // A device replaying a sale it took offline resends its key. Return the
  // original ticket rather than charging the customer a second time.
  if (body.clientTicketId) {
    const existing = await findByClientTicketId(db, body.clientTicketId);
    if (existing) return existing;
  }

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
        clientTicketId: body.clientTicketId ?? null,
        placedAt: body.placedAt ? new Date(body.placedAt) : null,
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

/** Wraps createTicket so two concurrent syncs of one sale both see one ticket. */
export async function createTicketIdempotent(
  db: Database,
  body: CreateTicketBody,
): Promise<TicketDto> {
  try {
    return await createTicket(db, body);
  } catch (err) {
    if (body.clientTicketId && isUniqueViolation(err)) {
      const winner = await findByClientTicketId(db, body.clientTicketId);
      if (winner) return winner;
    }
    throw err;
  }
}

/**
 * Records one tender against a ticket.
 *
 * A tender smaller than the balance is a partial payment, not an error: the
 * ticket stays open and the remainder is still owed. A tender larger than the
 * balance settles it and the excess is change. Only the final tender can
 * produce change, because earlier ones are applied in full.
 */
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

  // Replay detection is by key only. Two identical cash tenders are an ordinary
  // way to split a bill, so matching on amounts would silently swallow one.
  if (body.clientPaymentId) {
    const seen = await db.execute<{ ticketId: string }>(sql`
      SELECT ticket_id AS "ticketId"
        FROM ticket_payments
       WHERE client_payment_id = ${body.clientPaymentId}
    `);
    const row = seen.rows[0];
    if (row) {
      if (row.ticketId !== id) {
        throw conflict('PAYMENT_KEY_REUSED', 'That payment key belongs to another ticket', {
          ticketId: id,
        });
      }
      return getTicketById(db, id);
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Lock the ticket so two tenders arriving together are applied in series
      // and cannot both read the same remaining balance.
      const locked = await tx.execute<{ status: string; totalCents: number }>(sql`
        SELECT status, total_cents AS "totalCents" FROM tickets WHERE id = ${id} FOR UPDATE
      `);
      const ticket = locked.rows[0];
      if (!ticket) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`, { ticketId: id });
      if (ticket.status === 'void') {
        throw conflict('TICKET_NOT_OPEN', 'Ticket is void', { ticketId: id, status: ticket.status });
      }

      const priorRows = await tx.execute<{
        applied: number;
        tendered: number;
        change: number;
        taken: number;
      }>(sql`
        SELECT
          COALESCE(SUM(amount_applied_cents), 0)::int  AS applied,
          COALESCE(SUM(amount_tendered_cents), 0)::int AS tendered,
          COALESCE(SUM(change_due_cents), 0)::int      AS change,
          COUNT(*)::int                                AS taken
        FROM ticket_payments
        WHERE ticket_id = ${id}
      `);
      const prior = priorRows.rows[0] ?? { applied: 0, tendered: 0, change: 0, taken: 0 };

      const remaining = ticket.totalCents - prior.applied;
      if (remaining <= 0) {
        throw conflict('TICKET_ALREADY_PAID', 'Ticket is already paid in full', {
          ticketId: id,
          amountRemainingCents: 0,
        });
      }

      const { amountAppliedCents: appliedCents, changeDueCents } = applyTenderCents(
        remaining,
        body.amountTenderedCents,
      );
      const stillOwed = remaining - appliedCents;

      await tx.insert(ticketPayments).values({
        ticketId: id,
        clientPaymentId: body.clientPaymentId ?? null,
        sequence: prior.taken + 1,
        paymentMethod: 'cash',
        amountTenderedCents: body.amountTenderedCents,
        amountAppliedCents: appliedCents,
        changeDueCents,
      });

      // The ticket's own payment columns stay a maintained summary across all
      // tenders, which keeps the paid-ticket CHECK and old consumers correct.
      await tx.execute(sql`
        UPDATE tickets
           SET payment_method        = 'cash',
               amount_tendered_cents = ${prior.tendered + body.amountTenderedCents},
               change_due_cents      = ${prior.change + changeDueCents},
               status                = ${stillOwed === 0 ? 'paid' : 'open'}::ticket_status,
               paid_at               = ${stillOwed === 0 ? sql`now()` : sql`NULL`}
         WHERE id = ${id}
      `);
    });
  } catch (err) {
    // A concurrent replay of the same tender lost the unique-index race; the
    // winner recorded it, so report the resulting state rather than an error.
    if (body.clientPaymentId && isUniqueViolation(err)) return getTicketById(db, id);
    throw err;
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
      COALESCE(t.placed_at, t.created_at) AS "createdAt",
      COALESCE(ic.item_count, 0)::int AS "itemCount",
      count(*) OVER()::int            AS "totalCount"
    FROM tickets t
    LEFT JOIN LATERAL (
      SELECT SUM(ti.quantity)::int AS item_count
      FROM ticket_items ti
      WHERE ti.ticket_id = t.id
    ) ic ON TRUE
    ORDER BY COALESCE(t.placed_at, t.created_at) DESC, t.id DESC
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
