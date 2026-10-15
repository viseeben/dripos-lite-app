/**
 * Thin typed wrapper over AsyncStorage.
 *
 * Every read is defensive: a till that cannot parse its cache must still open,
 * so corrupt or absent values resolve to undefined rather than throwing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const StorageKeys = {
  menuCache: 'dripos.menu.v1',
  offlineQueue: 'dripos.queue.v1',
  settings: 'dripos.settings.v1',
} as const;

export async function readJson<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

/** Returns false if the write failed, so callers can surface a real problem. */
export async function writeJson(key: string, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing useful to do; the value simply stays.
  }
}
