import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Product } from '../types/api';

export const queryKeys = {
  products: ['products'] as const,
  tickets: (limit: number, offset: number) => ['tickets', limit, offset] as const,
  ticket: (id: string) => ['ticket', id] as const,
};

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: api.listProducts,
    // The menu rarely changes mid-shift; avoid refetching it on every focus.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Reads a single product out of the cached `/products` response.
 *
 * The customisation modal is opened from the menu, which has already loaded the
 * catalog, so this costs no extra request.
 */
export function useProduct(productId: string | undefined): {
  product: Product | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useProducts();
  return {
    product: productId ? query.data?.find((p) => p.id === productId) : undefined,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

export function useTickets(limit = 50, offset = 0) {
  return useQuery({
    queryKey: queryKeys.tickets(limit, offset),
    queryFn: () => api.listTickets(limit, offset),
  });
}

export function useTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ticket(ticketId ?? ''),
    queryFn: () => api.getTicket(ticketId as string),
    enabled: Boolean(ticketId),
  });
}
