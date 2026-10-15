/**
 * End-to-end API tests against a real Postgres database.
 *
 * Requires DATABASE_URL to point at a throwaway database: the suite migrates
 * it, seeds the fixture catalog, and truncates tickets between runs.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { applyCatalog, normalizeCatalog } from '../services/seed.js';
import type { ProductDto, TicketDto } from '../types/index.js';

let app: FastifyInstance;
let pool: pg.Pool;
let db: Database;
let products: ProductDto[];

const findProduct = (name: string): ProductDto => {
  const product = products.find((p) => p.name === name);
  if (!product) throw new Error(`fixture product "${name}" missing`);
  return product;
};

const optionId = (product: ProductDto, groupName: string, optionName: string): string => {
  const group = product.modifierGroups.find((g) => g.name === groupName);
  const option = group?.options.find((o) => o.name === optionName);
  if (!option) throw new Error(`fixture option "${groupName}/${optionName}" missing`);
  return option.id;
};

beforeAll(async () => {
  const config = loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
  pool = createPool(config.DATABASE_URL);
  db = createDb(pool);

  await runMigrations(pool, () => undefined);

  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'fixtures',
    'mock-catalog.json',
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    products: unknown;
    modifierGroups: unknown;
  };
  await applyCatalog(db, normalizeCatalog(fixture.products, fixture.modifierGroups));
  await pool.query('TRUNCATE tickets CASCADE');

  app = await buildApp(db, config);

  const response = await app.inject({ method: 'GET', url: '/products' });
  products = response.json<ProductDto[]>();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('GET /health', () => {
  it('reports ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('reports database reachability', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, database: 'up' });
  });
});

describe('GET /products', () => {
  it('returns the seeded catalog with modifier groups nested inline', () => {
    expect(products.length).toBeGreaterThan(0);
    const latte = findProduct('Latte');
    expect(latte.priceCents).toBe(525);
    expect(latte.modifierGroups.map((g) => g.name)).toContain('Size');
  });

  it('marks Size as required and exposes signed price deltas', () => {
    const size = findProduct('Latte').modifierGroups.find((g) => g.name === 'Size');
    expect(size?.required).toBe(true);
    expect(size?.options.find((o) => o.name === 'Small')?.priceDeltaCents).toBe(-50);
    expect(size?.options.find((o) => o.name === 'Large')?.priceDeltaCents).toBe(75);
  });

  it('returns products with no modifier groups as an empty array, not null', () => {
    expect(findProduct('Butter Croissant').modifierGroups).toEqual([]);
  });
});

describe('POST /tickets', () => {
  it('creates a ticket when the client arithmetic matches the server', async () => {
    const iced = findProduct('Iced Coffee');
    // 450 base + 0 (Medium) = 450 unit; x2 = 900 subtotal; tax 80; total 980.
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: iced.id,
            quantity: 2,
            selectedModifierOptionIds: [optionId(iced, 'Size', 'Medium')],
          },
        ],
        subtotalCents: 900,
        taxCents: 80,
        totalCents: 980,
      },
    });

    expect(response.statusCode).toBe(201);
    const ticket = response.json<TicketDto>();
    expect(ticket).toMatchObject({
      status: 'open',
      subtotalCents: 900,
      taxCents: 80,
      totalCents: 980,
    });
    expect(ticket.items).toHaveLength(1);
    expect(ticket.items[0]).toMatchObject({
      productName: 'Iced Coffee',
      quantity: 2,
      unitPriceCents: 450,
      lineTotalCents: 900,
    });
    expect(ticket.items[0]?.modifiers).toEqual([
      { name: 'Medium', groupName: 'Size', priceDeltaCents: 0 },
    ]);
  });

  it('applies negative and positive modifier deltas to the unit price', async () => {
    const latte = findProduct('Latte');
    // 525 - 50 (Small) + 75 (Oat) + 100 (Double) = 650
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: latte.id,
            quantity: 1,
            selectedModifierOptionIds: [
              optionId(latte, 'Size', 'Small'),
              optionId(latte, 'Milk', 'Oat Milk'),
              optionId(latte, 'Espresso Shots', 'Double'),
            ],
          },
        ],
        subtotalCents: 650,
        taxCents: 58, // 650 * 0.08875 = 57.6875 -> 58
        totalCents: 708,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<TicketDto>().items[0]?.unitPriceCents).toBe(650);
  });

  it('rejects a tampered total with 422 and reveals the correct figures', async () => {
    const iced = findProduct('Iced Coffee');
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: iced.id,
            quantity: 2,
            selectedModifierOptionIds: [optionId(iced, 'Size', 'Medium')],
          },
        ],
        subtotalCents: 1,
        taxCents: 0,
        totalCents: 1,
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.code).toBe('TOTAL_MISMATCH');
    expect(body.expected).toEqual({ subtotalCents: 900, taxCents: 80, totalCents: 980 });
  });

  it('rejects a missing required modifier group', async () => {
    const iced = findProduct('Iced Coffee');
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [{ productId: iced.id, quantity: 1, selectedModifierOptionIds: [] }],
        subtotalCents: 450,
        taxCents: 40,
        totalCents: 490,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('REQUIRED_MODIFIER_MISSING');
  });

  it('rejects two selections from the same single-select group', async () => {
    const iced = findProduct('Iced Coffee');
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: iced.id,
            quantity: 1,
            selectedModifierOptionIds: [
              optionId(iced, 'Size', 'Small'),
              optionId(iced, 'Size', 'Large'),
            ],
          },
        ],
        subtotalCents: 475,
        taxCents: 42,
        totalCents: 517,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('MULTIPLE_SELECTIONS_IN_GROUP');
  });

  it('rejects a modifier that belongs to a different product', async () => {
    const croissant = findProduct('Butter Croissant');
    const latte = findProduct('Latte');
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: croissant.id,
            quantity: 1,
            selectedModifierOptionIds: [optionId(latte, 'Espresso Shots', 'Double')],
          },
        ],
        subtotalCents: 475,
        taxCents: 42,
        totalCents: 517,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('MODIFIER_NOT_AVAILABLE_FOR_PRODUCT');
  });

  it('404s an unknown product', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: '00000000-0000-4000-8000-000000000000',
            quantity: 1,
            selectedModifierOptionIds: [],
          },
        ],
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('PRODUCT_NOT_FOUND');
  });

  it('400s a structurally invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: { items: [], subtotalCents: -1, taxCents: 0, totalCents: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});
describe('POST /tickets/:id/pay — split tender', () => {
  const openTicket = async (): Promise<TicketDto> => {
    const iced = findProduct('Iced Coffee');
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        items: [
          {
            productId: iced.id,
            quantity: 2,
            selectedModifierOptionIds: [optionId(iced, 'Size', 'Medium')],
          },
        ],
        subtotalCents: 900,
        taxCents: 80,
        totalCents: 980,
      },
    });
    return response.json<TicketDto>();
  };

  const tender = (ticketId: string, amountTenderedCents: number, clientPaymentId?: string) =>
    app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/pay`,
      payload: { paymentMethod: 'cash', amountTenderedCents, ...(clientPaymentId ? { clientPaymentId } : {}) },
    });

  it('settles a ticket in one tender, as before', async () => {
    const ticket = await openTicket();
    const response = await tender(ticket.id, 1000);

    expect(response.statusCode).toBe(200);
    expect(response.json<TicketDto>()).toMatchObject({
      status: 'paid',
      amountPaidCents: 980,
      amountRemainingCents: 0,
      changeDueCents: 20,
    });
    expect(response.json<TicketDto>().payments).toHaveLength(1);
  });

  it('leaves the ticket open and owing when a tender is short', async () => {
    const ticket = await openTicket();
    const response = await tender(ticket.id, 500);

    expect(response.statusCode).toBe(200);
    const after = response.json<TicketDto>();
    expect(after.status).toBe('open');
    expect(after.amountPaidCents).toBe(500);
    expect(after.amountRemainingCents).toBe(480);
    // A partial tender is applied in full, so it yields no change.
    expect(after.payments[0]).toMatchObject({
      sequence: 1,
      amountTenderedCents: 500,
      amountAppliedCents: 500,
      changeDueCents: 0,
    });
  });

  it('records each tender separately and settles on the last one', async () => {
    const ticket = await openTicket();

    const first = await tender(ticket.id, 500);
    expect(first.json<TicketDto>().status).toBe('open');

    const second = await tender(ticket.id, 1000);
    const paid = second.json<TicketDto>();

    expect(paid.status).toBe('paid');
    expect(paid.amountRemainingCents).toBe(0);
    expect(paid.payments).toHaveLength(2);

    expect(paid.payments[0]).toMatchObject({
      sequence: 1,
      amountTenderedCents: 500,
      amountAppliedCents: 500,
      changeDueCents: 0,
    });
    // Only the final tender can produce change: 480 owed, 1000 handed over.
    expect(paid.payments[1]).toMatchObject({
      sequence: 2,
      amountTenderedCents: 1000,
      amountAppliedCents: 480,
      changeDueCents: 520,
    });

    // The ticket's own columns stay a faithful summary of the tenders.
    expect(paid.amountTenderedCents).toBe(1500);
    expect(paid.changeDueCents).toBe(520);
  });

  it('handles an exact even split with no change', async () => {
    const ticket = await openTicket();
    await tender(ticket.id, 490);
    const response = await tender(ticket.id, 490);
    const paid = response.json<TicketDto>();

    expect(paid.status).toBe('paid');
    expect(paid.changeDueCents).toBe(0);
    expect(paid.payments.map((p) => p.amountAppliedCents)).toEqual([490, 490]);
  });

  it('handles a three-way split', async () => {
    const ticket = await openTicket();
    await tender(ticket.id, 300);
    await tender(ticket.id, 300);
    const response = await tender(ticket.id, 400);
    const paid = response.json<TicketDto>();

    expect(paid.status).toBe('paid');
    expect(paid.payments).toHaveLength(3);
    expect(paid.payments.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(paid.amountPaidCents).toBe(980);
    expect(paid.payments[2]).toMatchObject({ amountAppliedCents: 380, changeDueCents: 20 });
  });

  it('refuses a further tender once the ticket is settled', async () => {
    const ticket = await openTicket();
    await tender(ticket.id, 1000);

    const extra = await tender(ticket.id, 500);
    expect(extra.statusCode).toBe(409);
    expect(extra.json().code).toBe('TICKET_ALREADY_PAID');
  });

  it('treats two identical tenders without keys as two real tenders', async () => {
    // This is the heart of split tender: two people each handing over $5 must
    // never be collapsed into one payment by matching on amount.
    const ticket = await openTicket();
    await tender(ticket.id, 500);
    const second = await tender(ticket.id, 500);

    const after = second.json<TicketDto>();
    expect(after.payments).toHaveLength(2);
    expect(after.amountPaidCents).toBe(980);
    expect(after.status).toBe('paid');
  });

  it('treats a replayed tender key as the same tender', async () => {
    const ticket = await openTicket();
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const first = await tender(ticket.id, 500, key);
    expect(first.json<TicketDto>().payments).toHaveLength(1);

    const replay = await tender(ticket.id, 500, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<TicketDto>().payments).toHaveLength(1);
    expect(replay.json<TicketDto>().amountPaidCents).toBe(500);
  });

  it('rejects a payment key already used on another ticket', async () => {
    const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const a = await openTicket();
    const b = await openTicket();

    await tender(a.id, 500, key);
    const reused = await tender(b.id, 500, key);

    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('PAYMENT_KEY_REUSED');
  });

  it('never lets concurrent tenders overpay the balance', async () => {
    const ticket = await openTicket();
    const results = await Promise.all([
      tender(ticket.id, 1000),
      tender(ticket.id, 1000),
      tender(ticket.id, 1000),
    ]);

    const settled = await app.inject({ method: 'GET', url: `/tickets/${ticket.id}` });
    const after = settled.json<TicketDto>();

    expect(after.status).toBe('paid');
    expect(after.amountPaidCents).toBe(980);
    expect(after.amountRemainingCents).toBe(0);
    // Exactly one tender lands; the others find nothing left to pay.
    expect(after.payments).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });

  it('rejects a zero or negative tender', async () => {
    const ticket = await openTicket();
    expect((await tender(ticket.id, 0)).statusCode).toBe(400);
    expect((await tender(ticket.id, -100)).statusCode).toBe(400);
  });

  it('rejects payment methods other than cash', async () => {
    const ticket = await openTicket();
    const response = await app.inject({
      method: 'POST',
      url: `/tickets/${ticket.id}/pay`,
      payload: { paymentMethod: 'card', amountTenderedCents: 1000 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('UNSUPPORTED_PAYMENT_METHOD');
  });

  it('404s an unknown ticket', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tickets/00000000-0000-4000-8000-000000000000/pay',
      payload: { paymentMethod: 'cash', amountTenderedCents: 1000 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('TICKET_NOT_FOUND');
  });
});

describe('GET /tickets', () => {
  it('lists tickets newest first with a summed item count and a total', async () => {
    const response = await app.inject({ method: 'GET', url: '/tickets?limit=5&offset=0' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.tickets.length).toBeLessThanOrEqual(5);

    const timestamps = body.tickets.map((t: { createdAt: string }) => Date.parse(t.createdAt));
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);

    // The 2x Iced Coffee tickets carry two units on a single line.
    const twoUnit = body.tickets.find((t: { itemCount: number }) => t.itemCount === 2);
    expect(twoUnit).toBeDefined();
  });

  it('reports the correct total even when the page is empty', async () => {
    const response = await app.inject({ method: 'GET', url: '/tickets?limit=1&offset=100000' });
    expect(response.statusCode).toBe(200);
    expect(response.json().tickets).toEqual([]);
    expect(response.json().total).toBeGreaterThan(0);
  });

  it('rejects a limit above the maximum', async () => {
    const response = await app.inject({ method: 'GET', url: '/tickets?limit=500' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /tickets/:id', () => {
  it('returns the full ticket with items and modifiers', async () => {
    const list = await app.inject({ method: 'GET', url: '/tickets?limit=1' });
    const id = list.json().tickets[0].id as string;

    const response = await app.inject({ method: 'GET', url: `/tickets/${id}` });
    expect(response.statusCode).toBe(200);

    const ticket = response.json<TicketDto>();
    expect(ticket.id).toBe(id);
    expect(ticket.items.length).toBeGreaterThan(0);
    expect(ticket.totalCents).toBe(ticket.subtotalCents + ticket.taxCents);
  });

  it('400s a malformed id rather than 500ing', async () => {
    const response = await app.inject({ method: 'GET', url: '/tickets/not-a-uuid' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('offline sync (idempotent replay)', () => {
  const offlineSale = (clientTicketId: string, placedAt?: string) => {
    const iced = findProduct('Latte');
    return {
      items: [
        {
          productId: iced.id,
          quantity: 1,
          selectedModifierOptionIds: [
            optionId(iced, 'Size', 'Medium'),
            optionId(iced, 'Milk', 'Whole Milk'),
            optionId(iced, 'Espresso Shots', 'Double'),
          ],
        },
      ],
      // 525 base + 0 (Medium) + 0 (Whole Milk) + 100 (Double) = 625
      subtotalCents: 625,
      taxCents: 55, // 625 * 0.08875 = 55.46875 -> 55
      totalCents: 680,
      clientTicketId,
      ...(placedAt ? { placedAt } : {}),
    };
  };

  it('replaying a queued sale returns the original ticket, not a duplicate', async () => {
    const key = '11111111-1111-4111-8111-111111111111';

    const first = await app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) });
    expect(first.statusCode).toBe(201);
    const original = first.json<TicketDto>();

    const replay = await app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) });
    const replayed = replay.json<TicketDto>();

    expect(replayed.id).toBe(original.id);
    expect(replayed.clientTicketId).toBe(key);

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM tickets WHERE client_ticket_id = $1',
      [key],
    );
    expect(rows[0].n).toBe(1);
  });

  it('two concurrent syncs of one sale still produce exactly one ticket', async () => {
    const key = '22222222-2222-4222-8222-222222222222';
    const results = await Promise.all([
      app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) }),
      app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) }),
      app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) }),
    ]);

    for (const r of results) expect(r.statusCode).toBe(201);
    const ids = new Set(results.map((r) => r.json<TicketDto>().id));
    expect(ids.size).toBe(1);

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM tickets WHERE client_ticket_id = $1',
      [key],
    );
    expect(rows[0].n).toBe(1);
  });

  it('records when the sale happened on the device, not when it reached us', async () => {
    const key = '33333333-3333-4333-8333-333333333333';
    const placedAt = '2026-10-14T09:15:00.000Z';

    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: offlineSale(key, placedAt),
    });

    expect(response.statusCode).toBe(201);
    expect(new Date(response.json<TicketDto>().createdAt).toISOString()).toBe(placedAt);
  });

  it('replaying a keyed tender does not record it twice', async () => {
    const key = '44444444-4444-4444-8444-444444444444';
    const created = await app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) });
    const ticketId = created.json<TicketDto>().id;
    const payment = {
      paymentMethod: 'cash',
      amountTenderedCents: 1000,
      clientPaymentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };

    const first = await app.inject({ method: 'POST', url: `/tickets/${ticketId}/pay`, payload: payment });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({ method: 'POST', url: `/tickets/${ticketId}/pay`, payload: payment });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<TicketDto>()).toMatchObject({
      id: ticketId,
      status: 'paid',
      amountTenderedCents: 1000,
      changeDueCents: 1000 - 680,
    });
    expect(replay.json<TicketDto>().payments).toHaveLength(1);
  });

  it('refuses a further tender once a synced sale is settled', async () => {
    const key = '55555555-5555-4555-8555-555555555555';
    const created = await app.inject({ method: 'POST', url: '/tickets', payload: offlineSale(key) });
    const ticketId = created.json<TicketDto>().id;

    const first = await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/pay`,
      payload: { paymentMethod: 'cash', amountTenderedCents: 1000 },
    });
    expect(first.statusCode).toBe(200);

    const extra = await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/pay`,
      payload: { paymentMethod: 'cash', amountTenderedCents: 2000 },
    });
    expect(extra.statusCode).toBe(409);
    expect(extra.json().code).toBe('TICKET_ALREADY_PAID');
  });

  it('an online ticket carries no idempotency key and never collides', async () => {
    const iced = findProduct('Iced Coffee');
    const payload = {
      items: [
        { productId: iced.id, quantity: 2, selectedModifierOptionIds: [optionId(iced, 'Size', 'Medium')] },
      ],
      subtotalCents: 900,
      taxCents: 80,
      totalCents: 980,
    };
    const a = await app.inject({ method: 'POST', url: '/tickets', payload });
    const b = await app.inject({ method: 'POST', url: '/tickets', payload });

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json<TicketDto>().id).not.toBe(b.json<TicketDto>().id);
    expect(a.json<TicketDto>().clientTicketId).toBeNull();
  });
});

describe('GET /admin/diagnostics', () => {
  it('reports catalog counts and whether the menu is ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/diagnostics' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.menuReady).toBe(true);
    expect(body.catalog.products).toBeGreaterThan(0);
    expect(body.catalog.modifierOptions).toBeGreaterThan(0);
    expect(body.mockApiConfigured).toBe(typeof process.env['MOCK_API_URL'] === 'string');
  });

  it('never exposes the admin token or the mock API URL', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/diagnostics' });
    const raw = response.body;
    expect(raw).not.toContain('MOCK_API_URL=');
    expect(response.json().adminTokenConfigured).toBeTypeOf('boolean');
    // The flags say whether they are configured, never what they are.
    expect(raw).not.toMatch(/https?:\/\//);
  });
});

describe('unknown routes', () => {
  it('404s with the standard error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('ROUTE_NOT_FOUND');
  });
});
