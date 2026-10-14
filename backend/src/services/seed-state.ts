/**
 * Remembers the outcome of the most recent seed so `GET /admin/diagnostics`
 * can explain an empty menu without anyone having to read deploy logs.
 */
import type { SeedCounts } from './seed.js';

export interface SeedState {
  ok: boolean;
  at: string;
  counts?: SeedCounts;
  error?: string;
}

let lastSeed: SeedState | undefined;

/** Keeps the mock API URL (which carries a key) out of anything we serve. */
function redact(message: string, mockApiUrl: string | undefined): string {
  return mockApiUrl ? message.split(mockApiUrl).join('<MOCK_API_URL>') : message;
}

export function recordSeedSuccess(counts: SeedCounts): void {
  lastSeed = { ok: true, at: new Date().toISOString(), counts };
}

export function recordSeedFailure(error: unknown, mockApiUrl: string | undefined): void {
  const message = error instanceof Error ? error.message : String(error);
  lastSeed = { ok: false, at: new Date().toISOString(), error: redact(message, mockApiUrl) };
}

export function getSeedState(): SeedState | undefined {
  return lastSeed;
}
