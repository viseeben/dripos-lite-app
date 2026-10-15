import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from './api';
import { StorageKeys, readJson, writeJson } from './storage';
import { isOfflineNow } from '../store/connectivity';
import type { Product } from '../types/api';

export const queryKeys = {
  products: ['products'] as const,
  tickets: (limit: number, offset: number) => ['tickets', limit, offset] as const,
  ticket: (id: string) => ['ticket', id] as const,
};

export interface MenuResult {
  products: Product[];
  /** True when the menu came from disk because the network was unavailable. */
  fromCache: boolean;
  /** When the cached copy was last refreshed from the server. */
  cachedAt?: string;
}

interface CachedMenu {
  products: Product[];
  cachedAt: string;
}

/**
 * The menu must survive losing connectivity, so every successful fetch is
 * written to disk and a failed one falls back to that copy. A till with a
 * stale menu can still take orders; a till with no menu cannot.
 */
async function fetchMenu(): Promise<MenuResult> {
  let networkError: unknown;

  if (!isOfflineNow()) {
    try {
      const products = await api.listProducts();
      await writeJson(StorageKeys.menuCache, {
        products,
        cachedAt: new Date().toISOString(),
      } satisfies CachedMenu);
      return { products, fromCache: false };
    } catch (err) {
      networkError = err;
    }
  }

  const cached = await readJson<CachedMenu>(StorageKeys.menuCache);
  if (cached && cached.products.length > 0) {
    return { products: cached.products, fromCache: true, cachedAt: cached.cachedAt };
  }

  throw (
    networkError ??
    new ApiError(
      0,
      'OFFLINE_NO_CACHE',
      'No connection, and this device has not loaded the menu yet. Connect once to download it.',
    )
  );
}

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: fetchMenu,
    staleTime: 5 * 60 * 1000,
    // The fallback already handles being offline; retrying just delays it.
    retry: 0,
  });
}

export function useProduct(productId: string | undefined): {
  product: Product | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useProducts();
  return {
    product: productId ? query.data?.products.find((p) => p.id === productId) : undefined,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

export function useTickets(limit = 50, offset = 0) {
  const offline = isOfflineNow();
  return useQuery({
    queryKey: queryKeys.tickets(limit, offset),
    queryFn: () => api.listTickets(limit, offset),
    // Offline, the server list is unreachable; the screen shows queued sales.
    enabled: !offline,
    retry: 0,
  });
}

export function useTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ticket(ticketId ?? ''),
    queryFn: () => api.getTicket(ticketId as string),
    enabled: Boolean(ticketId),
    retry: 0,
  });
}
