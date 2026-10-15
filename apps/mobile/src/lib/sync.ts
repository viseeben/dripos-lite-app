/**
 * Drains the offline queue.
 *
 * Safety rests on three things working together:
 *
 *  1. Each sale carries a `clientTicketId` minted once and persisted before the
 *     first attempt, so every retry sends the same key and the server collapses
 *     them onto one ticket.
 *  2. Payment is replayed with identical values, which the server treats as the
 *     same payment rather than a second one.
 *  3. Only one drain runs at a time, and a sale is marked synced only after the
 *     server has confirmed both steps.
 *
 * Together those mean a crash at any point is recoverable by simply trying
 * again - there is no partial state that a retry makes worse.
 */
import { create } from 'zustand';
import { ApiError, api, errorMessage } from './api';
import { isOfflineNow } from '../store/connectivity';
import { useQueueStore, type QueuedTicket } from '../store/queue';

export interface SyncOutcome {
  attempted: number;
  synced: number;
  failed: number;
  /** Set when the run stopped early because connectivity went away again. */
  interrupted: boolean;
}

interface SyncState {
  isSyncing: boolean;
  lastRunAt?: string;
  lastOutcome?: SyncOutcome;
  setSyncing: (syncing: boolean) => void;
  setResult: (outcome: SyncOutcome) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  isSyncing: false,
  setSyncing: (isSyncing) => set({ isSyncing }),
  setResult: (lastOutcome) => set({ lastOutcome, lastRunAt: new Date().toISOString() }),
}));

/**
 * How many times a sale may fail for a reason we did not anticipate before it
 * is parked. Network outages are exempt - those retry indefinitely, because the
 * connection genuinely will come back.
 */
const MAX_UNEXPECTED_ATTEMPTS = 5;

/**
 * A rejection the server will give the same answer to every time - a deleted
 * product, a total that no longer reconciles. Retrying cannot help.
 */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return false;
  return error.status >= 400 && error.status < 500;
}

function isNetworkOutage(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
}

/**
 * Decides what to do with a failed sale.
 *
 * The important case is the third one. An error that is neither a clean
 * rejection nor a network outage - a 5xx, or a bug in this code meeting an
 * unexpected response shape - must not retry forever in silence, because that
 * looks exactly like a sale that simply never syncs. After a few attempts it is
 * parked with its reason visible, and can be retried deliberately.
 */
function decide(error: unknown, attempts: number): 'park' | 'retry' {
  if (isPermanent(error)) return 'park';
  if (isNetworkOutage(error)) return 'retry';
  return attempts >= MAX_UNEXPECTED_ATTEMPTS ? 'park' : 'retry';
}

async function syncOne(queued: QueuedTicket): Promise<void> {
  const store = useQueueStore.getState();
  store.markSyncing(queued.clientTicketId);

  // Idempotent: replaying a key returns the original ticket untouched.
  const ticket = await api.createTicket({
    items: queued.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      selectedModifierOptionIds: item.modifiers.map((m) => m.optionId),
    })),
    subtotalCents: queued.subtotalCents,
    taxCents: queued.taxCents,
    totalCents: queued.totalCents,
    clientTicketId: queued.clientTicketId,
    placedAt: queued.placedAt,
  });

  // Already fully settled with every tender recorded: nothing left to send.
  // Defensive: an older backend omits `payments` entirely. The API layer fills
  // it in, but sync must not be the thing that breaks if anything slips past.
  if (ticket.status === 'paid' && (ticket.payments?.length ?? 0) >= queued.tenders.length) {
    useQueueStore.getState().markSynced(queued.clientTicketId, ticket.id);
    return;
  }

  // Each tender is its own payment, replayed under its own key. A tender a
  // previous attempt already recorded is recognised by that key and skipped
  // server-side, so re-sending the whole set is safe.
  for (const tender of queued.tenders) {
    await api.payTicket(ticket.id, {
      paymentMethod: 'cash',
      amountTenderedCents: tender.amountTenderedCents,
      clientPaymentId: tender.clientPaymentId,
    });
  }

  useQueueStore.getState().markSynced(queued.clientTicketId, ticket.id);
}

/**
 * Sends every queued sale, oldest first, and resolves with what happened.
 * Safe to call at any time: concurrent calls collapse into the one already
 * running rather than racing it.
 */
export async function syncQueue(): Promise<SyncOutcome> {
  const empty: SyncOutcome = { attempted: 0, synced: 0, failed: 0, interrupted: false };
  const sync = useSyncStore.getState();

  if (sync.isSyncing) return empty;
  if (isOfflineNow()) return { ...empty, interrupted: true };

  const queue = useQueueStore.getState();
  if (!queue.hydrated) return empty;

  const due = queue.tickets
    .filter((t) => t.status === 'pending')
    .slice()
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));

  if (due.length === 0) return empty;

  sync.setSyncing(true);
  const outcome: SyncOutcome = { attempted: 0, synced: 0, failed: 0, interrupted: false };

  try {
    for (const queued of due) {
      if (isOfflineNow()) {
        // Connectivity dropped mid-drain. Hand the rest back for next time.
        useQueueStore.getState().retry(queued.clientTicketId);
        outcome.interrupted = true;
        break;
      }

      outcome.attempted += 1;
      try {
        await syncOne(queued);
        outcome.synced += 1;
      } catch (err) {
        const store = useQueueStore.getState();
        const attempts =
          store.tickets.find((t) => t.clientTicketId === queued.clientTicketId)?.attempts ?? 0;

        if (decide(err, attempts) === 'park') {
          store.markFailed(queued.clientTicketId, errorMessage(err));
          outcome.failed += 1;
        } else {
          // Leave it pending so the next run picks it up unchanged.
          store.retry(queued.clientTicketId);
          outcome.interrupted = true;
          break;
        }
      }
    }
  } finally {
    useSyncStore.getState().setSyncing(false);
    useSyncStore.getState().setResult(outcome);
  }

  return outcome;
}
