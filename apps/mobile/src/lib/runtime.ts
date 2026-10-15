/**
 * Offline runtime: restores persisted state, watches connectivity, and drains
 * the queue whenever there is an opportunity to.
 *
 * Sync is triggered by events rather than polled, on the three occasions that
 * actually matter: the app starting, the connection returning, and the app
 * coming back to the foreground. Draining is idempotent and self-guarding, so
 * overlapping triggers are harmless.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { startConnectivityWatch, useConnectivityStore } from '../store/connectivity';
import { useQueueStore } from '../store/queue';
import { usePaymentSessionStore } from '../store/payment';
import { syncQueue } from './sync';

export function useOfflineRuntime(): { ready: boolean } {
  const [ready, setReady] = useState(false);
  const wasOffline = useRef(true);

  // Restore the queue and the offline switch before anything reads them, so
  // the pending count is never briefly and wrongly zero.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      useConnectivityStore.getState().hydrate(),
      useQueueStore.getState().hydrate(),
      usePaymentSessionStore.getState().hydrate(),
    ]).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => startConnectivityWatch(), []);

  // Drain on the offline -> online edge only, not on every state emission.
  useEffect(() => {
    if (!ready) return undefined;
    return useConnectivityStore.subscribe((state) => {
      const offline = state.simulateOffline || !state.networkOnline;
      if (wasOffline.current && !offline) void syncQueue();
      wasOffline.current = offline;
    });
  }, [ready]);

  // One attempt once everything is restored, for sales left over from last run.
  useEffect(() => {
    if (ready) void syncQueue();
  }, [ready]);

  // Returning to the foreground is the other moment connectivity may have
  // silently come back while the app was suspended.
  useEffect(() => {
    if (!ready) return undefined;
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') void syncQueue();
    });
    return () => subscription.remove();
  }, [ready]);

  return { ready };
}
