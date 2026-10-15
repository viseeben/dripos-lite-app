/**
 * API contract. Zod schemas are the single source of truth; TypeScript types
 * are inferred from them so the validator and the types can never drift.
 */
import { z } from 'zod';

const uuid = z.string().uuid();
const centsNonNegative = z.number().int().min(0).max(2_147_483_647);

/* ------------------------------------------------------------------ requests */

export const CreateTicketItemSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).max(999),
  selectedModifierOptionIds: z.array(uuid).max(50).default([]),
});

export const CreateTicketBodySchema = z.object({
  items: z.array(CreateTicketItemSchema).min(1).max(100),
  subtotalCents: centsNonNegative,
  taxCents: centsNonNegative,
  totalCents: centsNonNegative,
  /**
   * Idempotency key minted on the device. Required for sales taken offline and
   * replayed later: resending the same key returns the original ticket rather
   * than creating a second one.
   */
  clientTicketId: uuid.optional(),
  /** ISO timestamp of when the sale actually happened on the device. */
  placedAt: z.iso.datetime().optional(),
});

export const PaymentMethodSchema = z.enum(['cash', 'card', 'gift_card', 'other']);

export const PayTicketBodySchema = z.object({
  paymentMethod: PaymentMethodSchema,
  amountTenderedCents: z.number().int().min(1).max(2_147_483_647),
  /**
   * Idempotency key for this tender, minted on the device.
   *
   * Split tender makes two identical cash tenders entirely normal, so a replay
   * can only be told apart from a genuine second payment by key. Omitting it
   * forfeits replay safety: every call then records a new tender.
   */
  clientPaymentId: uuid.optional(),
});

export const TicketIdParamsSchema = z.object({ id: uuid });

export const ListTicketsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateTicketItem = z.infer<typeof CreateTicketItemSchema>;
export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;
export type PayTicketBody = z.infer<typeof PayTicketBodySchema>;
export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/* ----------------------------------------------------------------- responses */

export type TicketStatus = 'open' | 'paid' | 'void';

export type ModifierOptionDto = {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export type ModifierGroupDto = {
  id: string;
  name: string;
  required: boolean;
  options: ModifierOptionDto[];
}

export type ProductDto = {
  id: string;
  name: string;
  priceCents: number;
  modifierGroups: ModifierGroupDto[];
}

export type TicketPaymentDto = {
  id: string;
  sequence: number;
  paymentMethod: PaymentMethod;
  /** What the customer handed over for this tender. */
  amountTenderedCents: number;
  /** How much of it went against the balance; the remainder is change. */
  amountAppliedCents: number;
  changeDueCents: number;
  createdAt: string;
};

export type TicketItemModifierDto = {
  name: string;
  groupName: string;
  priceDeltaCents: number;
}

export type TicketItemDto = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers: TicketItemModifierDto[];
}

export type TicketDto = {
  id: string;
  status: TicketStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  amountTenderedCents: number | null;
  changeDueCents: number | null;
  createdAt: string;
  /** Echoed back so a syncing device can match a ticket to its queued sale. */
  clientTicketId: string | null;
  /** Every tender taken against this ticket, in the order they were taken. */
  payments: TicketPaymentDto[];
  /** Sum applied to the balance across all tenders. */
  amountPaidCents: number;
  /** Still owed. Zero once the ticket is paid. */
  amountRemainingCents: number;
  items: TicketItemDto[];
}

export type TicketSummaryDto = {
  id: string;
  status: TicketStatus;
  totalCents: number;
  itemCount: number;
  createdAt: string;
}

export type ListTicketsResponse = {
  tickets: TicketSummaryDto[];
  total: number;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  [key: string]: unknown;
}
