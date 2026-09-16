import { create } from 'zustand';
import {
  computeLineTotalCents,
  computeSubtotalCents,
  computeTaxCents,
  computeUnitPriceCents,
} from '../lib/money';

export interface SelectedModifier {
  modifierGroupId: string;
  modifierGroupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
}

export interface CartItem {
  /** Identifies this line within the cart. Session-scoped, never sent to the server. */
  cartId: string;
  productId: string;
  productName: string;
  productPriceCents: number;
  selectedModifiers: SelectedModifier[];
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export type NewCartItem = Omit<CartItem, 'cartId' | 'lineTotalCents' | 'unitPriceCents'>;

interface CartState {
  items: CartItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

interface CartActions {
  addItem: (item: NewCartItem) => void;
  updateQuantity: (cartId: string, quantity: number) => void;
  removeItem: (cartId: string) => void;
  clearCart: () => void;
}

export type CartStore = CartState & CartActions;

let lineCounter = 0;
const nextCartId = (): string => `line_${++lineCounter}`;

/** Two lines merge only if they are the same product with the same option set. */
function sameSelection(a: readonly SelectedModifier[], b: readonly SelectedModifier[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map((m) => m.optionId).sort();
  const right = b.map((m) => m.optionId).sort();
  return left.every((id, index) => id === right[index]);
}

/**
 * Derives every total from the line items.
 *
 * Totals are never mutated independently — each action rebuilds the item list
 * and hands it here, so the store cannot drift out of sync with itself.
 */
function withTotals(items: CartItem[]): CartState {
  const priced = items.map((item) => ({
    ...item,
    lineTotalCents: computeLineTotalCents(item.unitPriceCents, item.quantity),
  }));
  const subtotalCents = computeSubtotalCents(priced.map((i) => i.lineTotalCents));
  const taxCents = computeTaxCents(subtotalCents);
  return { items: priced, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

const EMPTY: CartState = { items: [], subtotalCents: 0, taxCents: 0, totalCents: 0 };

export const useCartStore = create<CartStore>()((set) => ({
  ...EMPTY,

  addItem: (incoming) =>
    set((state) => {
      const unitPriceCents = computeUnitPriceCents(
        incoming.productPriceCents,
        incoming.selectedModifiers.map((m) => m.priceDeltaCents),
      );

      const existing = state.items.find(
        (item) =>
          item.productId === incoming.productId &&
          sameSelection(item.selectedModifiers, incoming.selectedModifiers),
      );

      const items = existing
        ? state.items.map((item) =>
            item.cartId === existing.cartId
              ? { ...item, quantity: item.quantity + incoming.quantity }
              : item,
          )
        : [...state.items, { ...incoming, cartId: nextCartId(), unitPriceCents, lineTotalCents: 0 }];

      return withTotals(items);
    }),

  updateQuantity: (cartId, quantity) =>
    set((state) =>
      withTotals(
        quantity <= 0
          ? state.items.filter((item) => item.cartId !== cartId)
          : state.items.map((item) => (item.cartId === cartId ? { ...item, quantity } : item)),
      ),
    ),

  removeItem: (cartId) =>
    set((state) => withTotals(state.items.filter((item) => item.cartId !== cartId))),

  clearCart: () => set(EMPTY),
}));

/** Distinct line count — what the Cart tab badge shows. */
export const useCartLineCount = (): number => useCartStore((s) => s.items.length);
