import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { StorageKeys, readJson, writeJson } from '../lib/storage';

interface ConnectivityState {
  /** What the device reports. */
  networkOnline: boolean;
  /** Operator-facing switch in Settings, for demonstrating offline behaviour. */
  simulateOffline: boolean;
  /** False until the persisted setting has been read back. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setNetworkOnline: (online: boolean) => void;
  setSimulateOffline: (simulate: boolean) => void;
}

export const useConnectivityStore = create<ConnectivityState>()((set, get) => ({
  networkOnline: true,
  simulateOffline: false,
  hydrated: false,

  hydrate: async () => {
    const saved = await readJson<{ simulateOffline?: boolean }>(StorageKeys.settings);
    set({ simulateOffline: saved?.simulateOffline === true, hydrated: true });
  },

  setNetworkOnline: (online) => {
    if (get().networkOnline !== online) set({ networkOnline: online });
  },

  setSimulateOffline: (simulate) => {
    set({ simulateOffline: simulate });
    void writeJson(StorageKeys.settings, { simulateOffline: simulate });
  },
}));

/**
 * The only connectivity question the rest of the app should ask.
 *
 * `isInternetReachable` is deliberately treated as offline only when it is
 * explicitly false: it is null while the probe is still in flight, and
 * treating "unknown" as offline would queue sales that could have gone through.
 */
export function startConnectivityWatch(): () => void {
  return NetInfo.addEventListener((state) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    useConnectivityStore.getState().setNetworkOnline(online);
  });
}

export const useIsOffline = (): boolean =>
  useConnectivityStore((s) => s.simulateOffline || !s.networkOnline);

/** Non-reactive read, for use inside event handlers and the sync engine. */
export const isOfflineNow = (): boolean => {
  const { simulateOffline, networkOnline } = useConnectivityStore.getState();
  return simulateOffline || !networkOnline;
};
