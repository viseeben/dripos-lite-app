/** Drizzle table definitions. Mirrors `migrations/0001_initial.sql` exactly. */
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'paid', 'void']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'card', 'gift_card', 'other']);

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modifierGroups = pgTable('modifier_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  required: boolean('required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    modifierGroupId: uuid('modifier_group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.modifierGroupId] })],
);

export const modifierOptions = pgTable('modifier_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  modifierGroupId: uuid('modifier_group_id')
    .notNull()
    .references(() => modifierGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceDeltaCents: integer('price_delta_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: ticketStatusEnum('status').notNull().default('open'),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  paymentMethod: paymentMethodEnum('payment_method'),
  amountTenderedCents: integer('amount_tendered_cents'),
  changeDueCents: integer('change_due_cents'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ticketItems = pgTable('ticket_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  productName: text('product_name').notNull(),
  productPriceCents: integer('product_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ticketItemModifiers = pgTable('ticket_item_modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketItemId: uuid('ticket_item_id')
    .notNull()
    .references(() => ticketItems.id, { onDelete: 'cascade' }),
  modifierOptionId: uuid('modifier_option_id')
    .notNull()
    .references(() => modifierOptions.id),
  modifierGroupName: text('modifier_group_name').notNull(),
  modifierOptionName: text('modifier_option_name').notNull(),
  priceDeltaCents: integer('price_delta_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const schema = {
  products,
  modifierGroups,
  productModifierGroups,
  modifierOptions,
  tickets,
  ticketItems,
  ticketItemModifiers,
};
