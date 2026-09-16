/**
 * Typed API client.
 *
 * Hand-rolled rather than `ky`: ky v2 is pure ESM targeting Node 22 and is not
 * validated against Hermes/Metro, and this is ~60 lines with no bundler risk.
 * It also lets errors carry the backend's `{ error, code }` envelope, which the
 * checkout screen needs to explain a rejection instead of showing "HTTP 422".
 */
import type {
  CreateTicketRequest,
  ListTicketsResponse,
  PayTicketRequest,
  Product,
  Ticket,
} from '../types/api';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireBaseUrl(): string {
  if (!BASE_URL) {
    throw new ApiError(
      0,
      'MISSING_CONFIG',
      'EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env.local and set your backend URL, then restart with `npx expo start --clear`.',
    );
  }
  return BASE_URL.replace(/\/+$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${requireBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    // Abort, DNS failure and connection refused all land here.
    const aborted = (err as Error)?.name === 'AbortError';
    throw new ApiError(
      0,
      aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      aborted
        ? 'The request timed out. Check your connection and try again.'
        : `Could not reach the server at ${requireBaseUrl()}. Check EXPO_PUBLIC_API_URL and that the backend is running.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      typeof body['code'] === 'string' ? body['code'] : 'HTTP_ERROR',
      typeof body['error'] === 'string' ? body['error'] : `Request failed (${response.status})`,
      body,
    );
  }

  return parsed as T;
}

export const api = {
  listProducts: () => request<Product[]>('/products'),

  createTicket: (payload: CreateTicketRequest) =>
    request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(payload) }),

  payTicket: (ticketId: string, payload: PayTicketRequest) =>
    request<Ticket>(`/tickets/${ticketId}/pay`, { method: 'POST', body: JSON.stringify(payload) }),

  listTickets: (limit = 50, offset = 0) =>
    request<ListTicketsResponse>(`/tickets?limit=${limit}&offset=${offset}`),

  getTicket: (ticketId: string) => request<Ticket>(`/tickets/${ticketId}`),
};

/** Turns any thrown value into something worth showing a cashier. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
