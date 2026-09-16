/**
 * Money primitives — mirrored verbatim from `backend/src/utils/money.ts`.
 *
 * The client computes the totals it submits, and the server recomputes them
 * from the database and rejects any difference. These two files must therefore
 * agree exactly, so they are kept character-identical rather than approximately
 * the same. `npm run check:shared` at the repo root fails if they drift.
 */

/** New York City combined sales tax. */
export const TAX_RATE = 0.08875;

export function computeTaxCents(subtotalCents: number): number {
  return Math.round(subtotalCents * TAX_RATE);
}

export function computeUnitPriceCents(
  productPriceCents: number,
  priceDeltaCentsList: readonly number[],
): number {
  return priceDeltaCentsList.reduce((sum, delta) => sum + delta, productPriceCents);
}

export function computeLineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

export function computeSubtotalCents(lineTotals: readonly number[]): number {
  return lineTotals.reduce((sum, line) => sum + line, 0);
}

/** Formats integer cents as "$X.XX". Negative values render as "-$X.XX". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Formats a modifier price delta: "+$0.75", "-$0.50", or "Free". */
export function formatDelta(priceDeltaCents: number): string {
  if (priceDeltaCents === 0) return 'Free';
  const sign = priceDeltaCents > 0 ? '+' : '-';
  return `${sign}${formatCents(Math.abs(priceDeltaCents))}`;
}

/**
 * Parses a user-typed dollar amount into integer cents.
 * Returns null for anything that is not a well-formed amount.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d*(\.\d{0,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  // Round rather than truncate: 10.1 * 100 is 1009.9999... in binary floating point.
  return Math.round(value * 100);
}
