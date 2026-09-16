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
}

export interface PayTicketRequest {
  paymentMethod: PaymentMethod;
  amountTenderedCents: number;
}
