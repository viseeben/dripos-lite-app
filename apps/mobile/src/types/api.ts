/** Mirrors the backend contract in `backend/src/types/index.ts`. */

export type TicketStatus = 'open' | 'paid' | 'void';
export type PaymentMethod = 'cash' | 'card' | 'gift_card' | 'other';

export interface ModifierOption {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  options: ModifierOption[];
}

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  modifierGroups: ModifierGroup[];
}

export interface TicketPayment {
  id: string;
  sequence: number;
  paymentMethod: PaymentMethod;
  amountTenderedCents: number;
  amountAppliedCents: number;
  changeDueCents: number;
  createdAt: string;
}

export interface TicketItemModifier {
  name: string;
  groupName: string;
  priceDeltaCents: number;
}

export interface TicketItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers: TicketItemModifier[];
}

export interface Ticket {
  id: string;
  status: TicketStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  amountTenderedCents: number | null;
  changeDueCents: number | null;
  createdAt: string;
  /** Present on sales that originated offline; lets a device match its queue. */
  clientTicketId: string | null;
  /** Every tender taken against this ticket, in order. */
  payments: TicketPayment[];
  amountPaidCents: number;
  amountRemainingCents: number;
  items: TicketItem[];
}

export interface TicketSummary {
  id: string;
  status: TicketStatus;
  totalCents: number;
  itemCount: number;
  createdAt: string;
}

export interface ListTicketsResponse {
  tickets: TicketSummary[];
  total: number;
}

export interface CreateTicketRequest {
  items: Array<{
    productId: string;
    quantity: number;
    selectedModifierOptionIds: string[];
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Idempotency key for a sale taken offline and replayed later. */
  clientTicketId?: string;
  /** ISO timestamp of when the sale happened on the device. */
  placedAt?: string;
}

export interface PayTicketRequest {
  paymentMethod: PaymentMethod;
  amountTenderedCents: number;
  /** Idempotency key for this tender. Two identical tenders are legitimate. */
  clientPaymentId?: string;
}
