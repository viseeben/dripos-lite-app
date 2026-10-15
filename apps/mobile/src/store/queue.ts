/**
 * Durable queue of sales taken while offline.
 *
 * The invariant this file exists to protect: a sale is written to disk with a
 * stable identity *before* it is ever sent, and that identity never changes.
 * Restarting the app, retrying a sync, or two syncs overlapping therefore all
 * converge on one ticket and one payment, because the server treats that
 * identity as an idempotency key.
 */
import { create } from 'zustand';
import { StorageKeys, readJson, writeJson } from '../lib/storage';
import type { Ticket } from '../types/api';

export type QueuedStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedModifier {
  optionId: string;
  name: string;
  groupName: string;
  priceDeltaCents: number;
}

export interface QueuedItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers: QueuedModifier[];
}

export interface QueuedTicket {
  /** Idempotency key. Minted once, persisted, never regenerated. */
  clientTicketId: string;
  /** When the sale happened on this device, which may long predate its sync. */
  placedAt: string;
  items: QueuedItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountTenderedCents: number;
  changeDueCents: number;
  status: QueuedStatus;
  attempts: number;
  lastError?: string;
  /** Set once the server has accepted it. */
  serverTicketId?: string;
  syncedAt?: string;
}

export type NewQueuedTicket = Omit<
  QueuedTicket,
  'status' | 'attempts' | 'serverTicketId' | 'syncedAt' | 'lastError'
>;

interface QueueState {
  tickets: QueuedTicket[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  enqueue: (ticket: NewQueuedTicket) => Promise<QueuedTicket>;
  markSyncing: (clientTicketId: string) => void;
  markSynced: (clientTicketId: string, serverTicketId: string) => void;
  markFailed: (clientTicketId: string, error: string) => void;
  /** Returns a failed ticket to the queue so the next sync retries it. */
  retry: (clientTicketId: string) => void;
  clearSynced: () => void;
}

/** Keep a short tail of synced sales so the cashier sees them land. */
const SYNCED_HISTORY_LIMIT = 20;

function persist(tickets: QueuedTicket[]): void {
  void writeJson(StorageKeys.offlineQueue, tickets);
}

function prune(tickets: QueuedTicket[]): QueuedTicket[] {
  const synced = tickets.filter((t) => t.status === 'synced');
  if (synced.length <= SYNCED_HISTORY_LIMIT) return tickets;
  const drop = new Set(
    synced
      .slice()
      .sort((a, b) => (a.syncedAt ?? '').localeCompare(b.syncedAt ?? ''))
      .slice(0, synced.length - SYNCED_HISTORY_LIMIT)
      .map((t) => t.clientTicketId),
  );
  return tickets.filter((t) => !drop.has(t.clientTicketId));
}

export const useQueueStore = create<QueueState>()((set, get) => {
  const update = (fn: (tickets: QueuedTicket[]) => QueuedTicket[]): void => {
    const next = prune(fn(get().tickets));
    set({ tickets: next });
    persist(next);
  };

  const patch = (clientTicketId: string, changes: Partial<QueuedTicket>): void =>
    update((tickets) =>
      tickets.map((t) => (t.clientTicketId === clientTicketId ? { ...t, ...changes } : t)),
    );

  return {
    tickets: [],
    hydrated: false,

    hydrate: async () => {
      const saved = (await readJson<QueuedTicket[]>(StorageKeys.offlineQueue)) ?? [];
      // A sale left mid-sync by a crash or a force-quit must be retried, not
      // abandoned. Replaying it is safe: the server keys on clientTicketId.
      const recovered = saved.map((t) =>
        t.status === 'syncing' ? { ...t, status: 'pending' as const } : t,
      );
      set({ tickets: recovered, hydrated: true });
      if (recovered.some((t, i) => t.status !== saved[i]?.status)) persist(recovered);
    },

    enqueue: async (ticket) => {
      const queued: QueuedTicket = { ...ticket, status: 'pending', attempts: 0 };
      const next = prune([...get().tickets, queued]);
      set({ tickets: next });
      // Awaited, not fire-and-forget: the sale must be on disk before the app
      // tells the cashier it was taken.
      await writeJson(StorageKeys.offlineQueue, next);
      return queued;
    },

    markSyncing: (id) =>
      patch(id, { status: 'syncing', attempts: (find(get().tickets, id)?.attempts ?? 0) + 1 }),

    markSynced: (id, serverTicketId) =>
      patch(id, {
        status: 'synced',
        serverTicketId,
        syncedAt: new Date().toISOString(),
        lastError: undefined,
      }),

    markFailed: (id, error) => patch(id, { status: 'failed', lastError: error }),

    retry: (id) => patch(id, { status: 'pending', lastError: undefined }),

    clearSynced: () => update((tickets) => tickets.filter((t) => t.status !== 'synced')),
  };
});

function find(tickets: QueuedTicket[], clientTicketId: string): QueuedTicket | undefined {
  return tickets.find((t) => t.clientTicketId === clientTicketId);
}

/* ------------------------------------------------------------------ selectors */

export const selectUnsynced = (tickets: QueuedTicket[]): QueuedTicket[] =>
  tickets.filter((t) => t.status !== 'synced');

/** The number shown to the cashier: everything not yet banked on the server. */
export const usePendingCount = (): number =>
  useQueueStore((s) => s.tickets.filter((t) => t.status !== 'synced').length);

export const useQueuedTicket = (clientTicketId: string | undefined): QueuedTicket | undefined =>
  useQueueStore((s) =>
    clientTicketId ? s.tickets.find((t) => t.clientTicketId === clientTicketId) : undefined,
  );

/**
 * Renders a queued sale in the same shape as a server ticket, so the receipt
 * and ticket screens need no separate offline code path.
 */
export function queuedTicketToTicket(queued: QueuedTicket): Ticket {
  return {
    id: queued.clientTicketId,
    status: 'paid',
    subtotalCents: queued.subtotalCents,
    taxCents: queued.taxCents,
    totalCents: queued.totalCents,
    paymentMethod: 'cash',
    amountTenderedCents: queued.amountTenderedCents,
    changeDueCents: queued.changeDueCents,
    createdAt: queued.placedAt,
    clientTicketId: queued.clientTicketId,
    items: queued.items.map((item, index) => ({
      id: `${queued.clientTicketId}:${index}`,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
      modifiers: item.modifiers.map((m) => ({
        name: m.name,
        groupName: m.groupName,
        priceDeltaCents: m.priceDeltaCents,
      })),
    })),
  };
}
