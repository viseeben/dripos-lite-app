/**
 * The split payment in progress.
 *
 * Tenders are confirmed one at a time and accumulate here. Because this is
 * separate from the screen that collects an amount, backing out of that screen
 * throws away only the half-typed entry — everything already confirmed is
 * untouched. The session is persisted for the same reason the queue is: cash
 * that has been taken must not disappear because the app did.
 */
import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { StorageKeys, readJson, removeKey, writeJson } from '../lib/storage';
import { applyTenderCents } from '../lib/money';
import type { QueuedTender } from './queue';

interface PersistedSession {
  clientTicketId: string;
  totalCents: number;
  tenders: QueuedTender[];
}

interface PaymentSessionState {
  clientTicketId: string | null;
  /** The ticket total this session is settling; a change invalidates it. */
  totalCents: number;
  tenders: QueuedTender[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Begins or resumes a session for a cart totalling `totalCents`. */
  start: (totalCents: number) => void;
  addTender: (amountTenderedCents: number) => Promise<void>;
  removeTender: (clientPaymentId: string) => void;
  clear: () => void;
}

export const usePaymentSessionStore = create<PaymentSessionState>()((set, get) => {
  const save = (state: Pick<PaymentSessionState, 'clientTicketId' | 'totalCents' | 'tenders'>) => {
    if (!state.clientTicketId) {
      void removeKey(StorageKeys.paymentSession);
      return;
    }
    void writeJson(StorageKeys.paymentSession, {
      clientTicketId: state.clientTicketId,
      totalCents: state.totalCents,
      tenders: state.tenders,
    } satisfies PersistedSession);
  };

  return {
    clientTicketId: null,
    totalCents: 0,
    tenders: [],
    hydrated: false,

    hydrate: async () => {
      const saved = await readJson<PersistedSession>(StorageKeys.paymentSession);
      set(
        saved
          ? {
              clientTicketId: saved.clientTicketId,
              totalCents: saved.totalCents,
              tenders: saved.tenders ?? [],
              hydrated: true,
            }
          : { hydrated: true },
      );
    },

    start: (totalCents) => {
      const { clientTicketId, totalCents: current } = get();
      // Resuming the same sale keeps its tenders; a different total means the
      // cart changed underneath, and tenders taken for the old one no longer
      // apply, so the sale starts over with a fresh identity.
      if (clientTicketId && current === totalCents) return;
      const next = { clientTicketId: Crypto.randomUUID(), totalCents, tenders: [] };
      set(next);
      save(next);
    },

    addTender: async (amountTenderedCents) => {
      const { clientTicketId, totalCents, tenders } = get();
      if (!clientTicketId) return;
      const next = {
        clientTicketId,
        totalCents,
        tenders: [
          ...tenders,
          { clientPaymentId: Crypto.randomUUID(), amountTenderedCents },
        ],
      };
      set(next);
      // Awaited: the cash is in the drawer before the UI says it was taken.
      await writeJson(StorageKeys.paymentSession, next satisfies PersistedSession);
    },

    removeTender: (clientPaymentId) => {
      const { clientTicketId, totalCents, tenders } = get();
      const next = {
        clientTicketId,
        totalCents,
        tenders: tenders.filter((t) => t.clientPaymentId !== clientPaymentId),
      };
      set(next);
      save(next);
    },

    clear: () => {
      set({ clientTicketId: null, totalCents: 0, tenders: [] });
      void removeKey(StorageKeys.paymentSession);
    },
  };
});

export interface TenderLine extends QueuedTender {
  amountAppliedCents: number;
  changeDueCents: number;
}

export interface SessionTotals {
  lines: TenderLine[];
  amountPaidCents: number;
  amountRemainingCents: number;
  changeDueCents: number;
}

/** Applies the session's tenders against the total, exactly as the server will. */
export function summariseSession(totalCents: number, tenders: QueuedTender[]): SessionTotals {
  let remaining = totalCents;
  let changeDueCents = 0;
  const lines = tenders.map((tender) => {
    const split = applyTenderCents(remaining, tender.amountTenderedCents);
    remaining -= split.amountAppliedCents;
    changeDueCents += split.changeDueCents;
    return { ...tender, ...split };
  });
  return {
    lines,
    amountPaidCents: totalCents - remaining,
    amountRemainingCents: remaining,
    changeDueCents,
  };
}
