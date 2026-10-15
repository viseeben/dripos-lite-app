/**
 * The guarantee under test: a sale taken offline reaches the server exactly
 * once, however many times the app restarts or the sync is retried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ---------------------------------------------------------------- test doubles */

const diskStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => diskStore.get(key) ?? null,
    setItem: async (key: string, value: string) => void diskStore.set(key, value),
    removeItem: async (key: string) => void diskStore.delete(key),
  },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => undefined },
}));

// expo-crypto reaches into react-native, whose source is Flow and cannot be
// parsed here. Keys are deterministic so assertions can name them.
let uuidCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `generated-${++uuidCounter}`,
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      createTicket: vi.fn(),
      payTicket: vi.fn(),
      listProducts: vi.fn(),
      listTickets: vi.fn(),
      getTicket: vi.fn(),
    },
  };
});

import { ApiError, api, normalizeTicket } from '../lib/api';
import { useConnectivityStore } from '../store/connectivity';
import { useQueueStore, type NewQueuedTicket } from '../store/queue';
import { summariseSession } from '../store/payment';
import { syncQueue, useSyncStore } from '../lib/sync';

const mockApi = api as unknown as {
  createTicket: ReturnType<typeof vi.fn>;
  payTicket: ReturnType<typeof vi.fn>;
};

/* ------------------------------------------------------------------- fixtures */

const sale = (clientTicketId: string, placedAt = '2026-10-15T10:00:00.000Z'): NewQueuedTicket => ({
  clientTicketId,
  placedAt,
  items: [
    {
      productId: 'prod-latte',
      productName: 'Latte',
      quantity: 1,
      unitPriceCents: 525,
      lineTotalCents: 525,
      modifiers: [
        { optionId: 'opt-regular', name: 'Regular', groupName: 'Size', priceDeltaCents: 0 },
      ],
    },
  ],
  subtotalCents: 525,
  taxCents: 47,
  totalCents: 572,
  tenders: [{ clientPaymentId: `${clientTicketId}-p1`, amountTenderedCents: 1000 }],
});

/** The same sale, settled by two people splitting the bill. */
const splitSale = (clientTicketId: string): NewQueuedTicket => ({
  ...sale(clientTicketId),
  tenders: [
    { clientPaymentId: `${clientTicketId}-p1`, amountTenderedCents: 300 },
    { clientPaymentId: `${clientTicketId}-p2`, amountTenderedCents: 300 },
  ],
});

const serverTicket = (id: string, status: 'open' | 'paid' = 'open', paymentCount = 0) => ({
  id,
  status,
  subtotalCents: 525,
  taxCents: 47,
  totalCents: 572,
  paymentMethod: status === 'paid' ? 'cash' : null,
  amountTenderedCents: status === 'paid' ? 1000 : null,
  changeDueCents: status === 'paid' ? 428 : null,
  amountPaidCents: status === 'paid' ? 572 : 0,
  amountRemainingCents: status === 'paid' ? 0 : 572,
  payments: Array.from({ length: paymentCount }, (_unused, i) => ({
    id: `pay-${i + 1}`,
    sequence: i + 1,
    paymentMethod: 'cash' as const,
    amountTenderedCents: 1000,
    amountAppliedCents: 572,
    changeDueCents: 428,
    createdAt: '2026-10-15T10:00:00.000Z',
  })),
  createdAt: '2026-10-15T10:00:00.000Z',
  clientTicketId: null,
  items: [],
});

/** Simulates a cold start: drop in-memory state, keep the disk. */
async function restartApp(): Promise<void> {
  useQueueStore.setState({ tickets: [], hydrated: false });
  await useQueueStore.getState().hydrate();
}

beforeEach(async () => {
  diskStore.clear();
  vi.clearAllMocks();
  useQueueStore.setState({ tickets: [], hydrated: false });
  useSyncStore.setState({ isSyncing: false, lastRunAt: undefined, lastOutcome: undefined });
  useConnectivityStore.setState({ networkOnline: true, simulateOffline: false, hydrated: true });
  await useQueueStore.getState().hydrate();
});

/* ---------------------------------------------------------------------- tests */

describe('queue durability', () => {
  it('survives an app restart', async () => {
    await useQueueStore.getState().enqueue(sale('sale-1'));
    expect(useQueueStore.getState().tickets).toHaveLength(1);

    await restartApp();

    const [restored] = useQueueStore.getState().tickets;
    expect(restored?.clientTicketId).toBe('sale-1');
    expect(restored?.status).toBe('pending');
    expect(restored?.totalCents).toBe(572);
  });

  it('keeps the same identity across a restart, so a replay is not a new sale', async () => {
    await useQueueStore.getState().enqueue(sale('sale-1'));
    const before = useQueueStore.getState().tickets[0]?.clientTicketId;

    await restartApp();
    await restartApp();

    expect(useQueueStore.getState().tickets[0]?.clientTicketId).toBe(before);
  });

  it('recovers a sale abandoned mid-sync by a crash', async () => {
    await useQueueStore.getState().enqueue(sale('sale-1'));
    useQueueStore.getState().markSyncing('sale-1');
    expect(useQueueStore.getState().tickets[0]?.status).toBe('syncing');

    // Force-quit during the request. On restart it must be retried, not stranded.
    await restartApp();

    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');
  });
});

describe('syncQueue', () => {
  it('sends a queued sale and marks it synced', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    const outcome = await syncQueue();

    expect(outcome).toMatchObject({ attempted: 1, synced: 1, failed: 0 });
    expect(mockApi.createTicket).toHaveBeenCalledTimes(1);
    expect(mockApi.payTicket).toHaveBeenCalledTimes(1);

    const [ticket] = useQueueStore.getState().tickets;
    expect(ticket?.status).toBe('synced');
    expect(ticket?.serverTicketId).toBe('server-1');
  });

  it('sends the device-minted key so the server can deduplicate', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));

    await useQueueStore.getState().enqueue(sale('sale-1', '2026-10-15T09:30:00.000Z'));
    await syncQueue();

    expect(mockApi.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTicketId: 'sale-1',
        placedAt: '2026-10-15T09:30:00.000Z',
      }),
    );
  });

  it('does not resend a sale that already synced', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    await syncQueue();
    await syncQueue();
    await syncQueue();

    expect(mockApi.createTicket).toHaveBeenCalledTimes(1);
    expect(mockApi.payTicket).toHaveBeenCalledTimes(1);
  });

  it('does not pay twice when a previous attempt already paid', async () => {
    // The ticket exists and is already settled: a prior run died after paying.
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1', 'paid', 1));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    await syncQueue();

    expect(mockApi.createTicket).toHaveBeenCalledTimes(1);
    expect(mockApi.payTicket).not.toHaveBeenCalled();
    expect(useQueueStore.getState().tickets[0]?.status).toBe('synced');
  });

  it('survives a crash between create and pay without duplicating', async () => {
    // First attempt creates the ticket, then the app dies before paying.
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', 'connection lost'),
    );

    await useQueueStore.getState().enqueue(sale('sale-1'));
    await syncQueue();
    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');

    await restartApp();

    // Second attempt: create returns the SAME ticket, and payment completes.
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));
    await syncQueue();

    const keys = mockApi.createTicket.mock.calls.map(
      (call) => (call[0] as { clientTicketId: string }).clientTicketId,
    );
    expect(new Set(keys).size).toBe(1); // one identity across both attempts
    expect(useQueueStore.getState().tickets[0]?.serverTicketId).toBe('server-1');
    expect(useQueueStore.getState().tickets.filter((t) => t.status === 'synced')).toHaveLength(1);
  });

  it('leaves a sale pending after a transient failure, to retry later', async () => {
    mockApi.createTicket.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    const outcome = await syncQueue();

    expect(outcome.synced).toBe(0);
    expect(outcome.interrupted).toBe(true);
    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');
  });

  it('parks a permanently rejected sale instead of retrying it forever', async () => {
    mockApi.createTicket.mockRejectedValue(
      new ApiError(422, 'TOTAL_MISMATCH', 'Order total does not match.'),
    );

    await useQueueStore.getState().enqueue(sale('sale-1'));
    const outcome = await syncQueue();

    expect(outcome.failed).toBe(1);
    const [ticket] = useQueueStore.getState().tickets;
    expect(ticket?.status).toBe('failed');
    expect(ticket?.lastError).toContain('total does not match');

    // A failed sale is not picked up again until explicitly retried.
    await syncQueue();
    expect(mockApi.createTicket).toHaveBeenCalledTimes(1);

    useQueueStore.getState().retry('sale-1');
    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');
  });

  it('sends sales oldest first', async () => {
    mockApi.createTicket.mockImplementation(async () => serverTicket('server-x'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-x', 'paid'));

    await useQueueStore.getState().enqueue(sale('late', '2026-10-15T12:00:00.000Z'));
    await useQueueStore.getState().enqueue(sale('early', '2026-10-15T08:00:00.000Z'));
    await syncQueue();

    const order = mockApi.createTicket.mock.calls.map(
      (call) => (call[0] as { clientTicketId: string }).clientTicketId,
    );
    expect(order).toEqual(['early', 'late']);
  });

  it('collapses overlapping drains instead of racing them', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    mockApi.createTicket.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));

    await useQueueStore.getState().enqueue(sale('sale-1'));

    const first = syncQueue();
    const second = await syncQueue(); // starts while the first is in flight
    expect(second).toMatchObject({ attempted: 0, synced: 0 });

    resolveCreate(serverTicket('server-1'));
    await first;

    expect(mockApi.createTicket).toHaveBeenCalledTimes(1);
  });

  it('does nothing while offline', async () => {
    useConnectivityStore.setState({ simulateOffline: true });
    await useQueueStore.getState().enqueue(sale('sale-1'));

    const outcome = await syncQueue();

    expect(outcome.attempted).toBe(0);
    expect(mockApi.createTicket).not.toHaveBeenCalled();
    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');
  });
});

describe('split tender', () => {
  it('replays every tender under its own key', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid', 2));

    await useQueueStore.getState().enqueue(splitSale('sale-1'));
    await syncQueue();

    expect(mockApi.payTicket).toHaveBeenCalledTimes(2);
    const keys = mockApi.payTicket.mock.calls.map(
      (call) => (call[1] as { clientPaymentId: string }).clientPaymentId,
    );
    expect(keys).toEqual(['sale-1-p1', 'sale-1-p2']);
    expect(new Set(keys).size).toBe(2);
  });

  it('does not resend tenders after a retry', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid', 2));

    await useQueueStore.getState().enqueue(splitSale('sale-1'));
    await syncQueue();
    await syncQueue();

    expect(mockApi.payTicket).toHaveBeenCalledTimes(2);
  });

  it('keeps tender keys stable across an app restart', async () => {
    mockApi.createTicket.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await useQueueStore.getState().enqueue(splitSale('sale-1'));
    await syncQueue();
    await restartApp();

    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid', 2));
    await syncQueue();

    const keys = mockApi.payTicket.mock.calls.map(
      (call) => (call[1] as { clientPaymentId: string }).clientPaymentId,
    );
    expect(keys).toEqual(['sale-1-p1', 'sale-1-p2']);
  });

  it('derives balances the way the server will', () => {
    const totals = summariseSession(980, [
      { clientPaymentId: 'a', amountTenderedCents: 500 },
      { clientPaymentId: 'b', amountTenderedCents: 1000 },
    ]);

    expect(totals.amountPaidCents).toBe(980);
    expect(totals.amountRemainingCents).toBe(0);
    // Only the final tender yields change: 480 owed, 1000 handed over.
    expect(totals.lines[0]).toMatchObject({ amountAppliedCents: 500, changeDueCents: 0 });
    expect(totals.lines[1]).toMatchObject({ amountAppliedCents: 480, changeDueCents: 520 });
    expect(totals.changeDueCents).toBe(520);
  });

  it('reports what is still owed part-way through a split', () => {
    const totals = summariseSession(980, [{ clientPaymentId: 'a', amountTenderedCents: 300 }]);
    expect(totals.amountPaidCents).toBe(300);
    expect(totals.amountRemainingCents).toBe(680);
    expect(totals.changeDueCents).toBe(0);
  });
});

describe('upgrading from the pre-split-tender queue', () => {
  it('converts a sale queued by the previous version', async () => {
    // Written by the old build: one tender, recorded inline, under the old key.
    diskStore.set(
      'dripos.queue.v1',
      JSON.stringify([
        {
          clientTicketId: 'legacy-1',
          placedAt: '2026-10-15T09:00:00.000Z',
          items: [],
          subtotalCents: 525,
          taxCents: 47,
          totalCents: 572,
          amountTenderedCents: 1000,
          changeDueCents: 428,
          status: 'pending',
          attempts: 0,
        },
      ]),
    );

    await restartApp();

    const [migrated] = useQueueStore.getState().tickets;
    expect(migrated?.clientTicketId).toBe('legacy-1');
    expect(migrated?.status).toBe('pending');
    expect(migrated?.tenders).toEqual([
      { clientPaymentId: 'legacy-1-1', amountTenderedCents: 1000 },
    ]);
  });
});

describe('tolerating an older backend', () => {
  // The app and the server deploy separately, so new app + old server happens.
  const legacyPaidTicket = {
    id: 'server-1',
    status: 'paid',
    subtotalCents: 525,
    taxCents: 47,
    totalCents: 572,
    paymentMethod: 'cash',
    amountTenderedCents: 1000,
    changeDueCents: 428,
    createdAt: '2026-10-15T10:00:00.000Z',
    clientTicketId: null,
    items: [],
    // No `payments`, no `amountPaidCents`, no `amountRemainingCents`.
  } as unknown as Parameters<typeof normalizeTicket>[0];

  it('fills in a ticket that predates split tender', () => {
    const ticket = normalizeTicket(legacyPaidTicket);

    expect(ticket.payments).toHaveLength(1);
    expect(ticket.payments[0]).toMatchObject({
      sequence: 1,
      paymentMethod: 'cash',
      amountTenderedCents: 1000,
      amountAppliedCents: 572,
      changeDueCents: 428,
    });
    expect(ticket.amountPaidCents).toBe(572);
    expect(ticket.amountRemainingCents).toBe(0);
  });

  it('gives an unpaid legacy ticket an empty payment list rather than undefined', () => {
    const ticket = normalizeTicket({
      ...legacyPaidTicket,
      status: 'open',
      paymentMethod: null,
      amountTenderedCents: null,
      changeDueCents: null,
    } as unknown as Parameters<typeof normalizeTicket>[0]);

    expect(ticket.payments).toEqual([]);
    expect(ticket.amountPaidCents).toBe(0);
    expect(ticket.amountRemainingCents).toBe(572);
  });

  it('syncs a sale even if the response has no payments array at all', async () => {
    // Regression: this threw a TypeError, which was then classified as
    // transient, so the sale retried forever and never synced.
    mockApi.createTicket.mockResolvedValue({
      id: 'server-1',
      status: 'open',
      totalCents: 572,
      items: [],
    });
    mockApi.payTicket.mockResolvedValue({ id: 'server-1', status: 'paid', totalCents: 572 });

    await useQueueStore.getState().enqueue(sale('sale-1'));
    const outcome = await syncQueue();

    expect(outcome.synced).toBe(1);
    expect(useQueueStore.getState().tickets[0]?.status).toBe('synced');
  });
});

describe('an error nobody anticipated', () => {
  it('is parked with its reason rather than retried forever', async () => {
    // Not an ApiError, so neither a clean rejection nor a network outage.
    mockApi.createTicket.mockRejectedValue(
      new TypeError("Cannot read property 'length' of undefined"),
    );

    await useQueueStore.getState().enqueue(sale('sale-1'));

    for (let i = 0; i < 6; i += 1) await syncQueue();

    const [ticket] = useQueueStore.getState().tickets;
    expect(ticket?.status).toBe('failed');
    expect(ticket?.lastError).toContain('length');
    // It stopped trying instead of hammering the server indefinitely.
    expect(mockApi.createTicket.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('still retries a network outage indefinitely', async () => {
    mockApi.createTicket.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    for (let i = 0; i < 8; i += 1) await syncQueue();

    // Never parked: the connection genuinely will come back.
    expect(useQueueStore.getState().tickets[0]?.status).toBe('pending');
  });
});

describe('pending count', () => {
  it('counts everything not yet banked on the server', async () => {
    mockApi.createTicket.mockResolvedValue(serverTicket('server-1'));
    mockApi.payTicket.mockResolvedValue(serverTicket('server-1', 'paid'));

    await useQueueStore.getState().enqueue(sale('sale-1'));
    await useQueueStore.getState().enqueue(sale('sale-2'));

    const unsynced = () =>
      useQueueStore.getState().tickets.filter((t) => t.status !== 'synced').length;

    expect(unsynced()).toBe(2);
    await syncQueue();
    expect(unsynced()).toBe(0);
  });
});
