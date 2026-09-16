import { describe, expect, it } from 'vitest';
import {
  computeLineTotalCents,
  computeSubtotalCents,
  computeTaxCents,
  computeUnitPriceCents,
  formatCents,
  formatDelta,
  isValidCents,
} from '../utils/money.js';

describe('computeTaxCents', () => {
  it('matches the worked example from the spec', () => {
    expect(computeTaxCents(900)).toBe(80); // 900 * 0.08875 = 79.875 -> 80
  });

  it('is zero for an empty order', () => {
    expect(computeTaxCents(0)).toBe(0);
  });

  it('always returns an integer', () => {
    for (let subtotal = 0; subtotal <= 5000; subtotal += 7) {
      expect(Number.isInteger(computeTaxCents(subtotal))).toBe(true);
    }
  });

  it('rounds half away from zero, never truncating', () => {
    // 800 * 0.08875 = 71.0 exactly
    expect(computeTaxCents(800)).toBe(71);
    // 1000 * 0.08875 = 88.75 -> 89
    expect(computeTaxCents(1000)).toBe(89);
  });
});

describe('computeUnitPriceCents', () => {
  it('sums positive and negative deltas onto the base price', () => {
    expect(computeUnitPriceCents(450, [-50, 75, 0])).toBe(475);
  });

  it('returns the base price when nothing is selected', () => {
    expect(computeUnitPriceCents(450, [])).toBe(450);
  });
});

describe('line and subtotal arithmetic', () => {
  it('multiplies unit price by quantity', () => {
    expect(computeLineTotalCents(475, 3)).toBe(1425);
  });

  it('sums line totals', () => {
    expect(computeSubtotalCents([1425, 300, 0])).toBe(1725);
  });

  it('sums to zero for an empty cart', () => {
    expect(computeSubtotalCents([])).toBe(0);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [50, '$0.50'],
    [980, '$9.80'],
    [100000, '$1000.00'],
    [-250, '-$2.50'],
  ])('formats %i as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe('formatDelta', () => {
  it.each([
    [0, 'Free'],
    [75, '+$0.75'],
    [-50, '-$0.50'],
  ])('formats %i as %s', (cents, expected) => {
    expect(formatDelta(cents)).toBe(expected);
  });
});

describe('isValidCents', () => {
  it('accepts values an INTEGER column can hold', () => {
    expect(isValidCents(0)).toBe(true);
    expect(isValidCents(2_147_483_647)).toBe(true);
  });

  it('rejects overflow and non-integers', () => {
    expect(isValidCents(2_147_483_648)).toBe(false);
    expect(isValidCents(1.5)).toBe(false);
    expect(isValidCents(Number.NaN)).toBe(false);
  });
});
