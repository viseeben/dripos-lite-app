/**
 * Money primitives. THE ONLY place tax/price arithmetic is defined.
 *
 * Invariant: money is always an integer number of cents. Never a float,
 * never a string, never a `NUMERIC` column. The only division by 100 in the
 * entire codebase happens inside `formatCents`, for display.
 *
 * This file is mirrored verbatim into the mobile app (see `shared/`), because
 * the client must compute byte-identical totals to what the server recomputes.
 */

/** New York City combined sales tax. */
export const TAX_RATE = 0.08875;

/** `Math.round` half-up on the exact product; must match the client bit for bit. */
export function computeTaxCents(subtotalCents: number): number {
  return Math.round(subtotalCents * TAX_RATE);
}

/** Unit price = base price plus every selected option's delta (deltas may be negative). */
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

/** True for values safe to store in an INTEGER money column. */
export function isValidCents(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= 2_147_483_647;
}
