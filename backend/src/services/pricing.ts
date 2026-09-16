/**
 * Authoritative price recomputation.
 *
 * The server never trusts a number the client sent. Every ticket is priced from
 * scratch out of the database, and the client's arithmetic is only ever compared
 * against ours — never used.
 *
 * Costs exactly 3 queries regardless of how many line items are on the ticket.
 */
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { modifierGroups, modifierOptions, productModifierGroups, products } from '../db/schema.js';
import {
  computeLineTotalCents,
  computeSubtotalCents,
  computeTaxCents,
  computeUnitPriceCents,
  isValidCents,
} from '../utils/money.js';
import { notFound, unprocessable } from '../utils/errors.js';
import type { CreateTicketItem } from '../types/index.js';

export interface ComputedModifier {
  optionId: string;
  optionName: string;
  groupId: string;
  groupName: string;
  priceDeltaCents: number;
  sortOrder: number;
}

export interface ComputedItem {
  productId: string;
  productName: string;
  productPriceCents: number;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers: ComputedModifier[];
}

export interface ComputedTicket {
  items: ComputedItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export async function recomputeTicket(
  db: Database,
  items: readonly CreateTicketItem[],
): Promise<ComputedTicket> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const optionIds = [...new Set(items.flatMap((i) => i.selectedModifierOptionIds))];

  /* ---- 1. products -------------------------------------------------- */
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      priceCents: products.priceCents,
    })
    .from(products)
    .where(inArray(products.id, productIds));

  const productById = new Map(productRows.map((p) => [p.id, p]));
  for (const id of productIds) {
    if (!productById.has(id)) {
      throw notFound('PRODUCT_NOT_FOUND', `Product ${id} not found`, { productId: id });
    }
  }

  /* ---- 2. which groups each product offers, and which are required --- */
  const linkRows = await db
    .select({
      productId: productModifierGroups.productId,
      groupId: modifierGroups.id,
      groupName: modifierGroups.name,
      required: modifierGroups.required,
      sortOrder: productModifierGroups.sortOrder,
    })
    .from(productModifierGroups)
    .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.modifierGroupId))
    .where(inArray(productModifierGroups.productId, productIds));

  const groupsByProduct = new Map<string, typeof linkRows>();
  for (const row of linkRows) {
    const list = groupsByProduct.get(row.productId);
    if (list) list.push(row);
    else groupsByProduct.set(row.productId, [row]);
  }

  /* ---- 3. the selected options -------------------------------------- */
  const optionRows =
    optionIds.length > 0
      ? await db
          .select({
            id: modifierOptions.id,
            name: modifierOptions.name,
            groupId: modifierOptions.modifierGroupId,
            priceDeltaCents: modifierOptions.priceDeltaCents,
            sortOrder: modifierOptions.sortOrder,
          })
          .from(modifierOptions)
          .where(inArray(modifierOptions.id, optionIds))
      : [];

  const optionById = new Map(optionRows.map((o) => [o.id, o]));
  for (const id of optionIds) {
    if (!optionById.has(id)) {
      throw notFound('MODIFIER_OPTION_NOT_FOUND', `Modifier option ${id} not found`, {
        modifierOptionId: id,
      });
    }
  }

  /* ---- price every line --------------------------------------------- */
  const computedItems: ComputedItem[] = items.map((item, index) => {
    const product = productById.get(item.productId);
    /* istanbul ignore next — guaranteed present by the check above, narrows the type */
    if (!product) throw notFound('PRODUCT_NOT_FOUND', `Product ${item.productId} not found`);

    const productGroups = groupsByProduct.get(item.productId) ?? [];
    const groupById = new Map(productGroups.map((g) => [g.groupId, g]));

    const selected: ComputedModifier[] = [];
    const selectionsPerGroup = new Map<string, number>();

    for (const optionId of item.selectedModifierOptionIds) {
      const option = optionById.get(optionId);
      /* istanbul ignore next — guaranteed present above */
      if (!option) throw notFound('MODIFIER_OPTION_NOT_FOUND', `Modifier option ${optionId} not found`);

      const group = groupById.get(option.groupId);
      if (!group) {
        throw unprocessable(
          'MODIFIER_NOT_AVAILABLE_FOR_PRODUCT',
          `Modifier option "${option.name}" is not offered by "${product.name}"`,
          { itemIndex: index, productId: item.productId, modifierOptionId: optionId },
        );
      }

      const count = (selectionsPerGroup.get(option.groupId) ?? 0) + 1;
      selectionsPerGroup.set(option.groupId, count);
      if (count > 1) {
        throw unprocessable(
          'MULTIPLE_SELECTIONS_IN_GROUP',
          `Modifier group "${group.groupName}" accepts exactly one selection`,
          { itemIndex: index, modifierGroupId: option.groupId },
        );
      }

      selected.push({
        optionId: option.id,
        optionName: option.name,
        groupId: option.groupId,
        groupName: group.groupName,
        priceDeltaCents: option.priceDeltaCents,
        sortOrder: option.sortOrder,
      });
    }

    for (const group of productGroups) {
      if (group.required && (selectionsPerGroup.get(group.groupId) ?? 0) !== 1) {
        throw unprocessable(
          'REQUIRED_MODIFIER_MISSING',
          `Modifier group "${group.groupName}" is required and needs exactly one selection`,
          { itemIndex: index, productId: item.productId, modifierGroupId: group.groupId },
        );
      }
    }

    const unitPriceCents = computeUnitPriceCents(
      product.priceCents,
      selected.map((m) => m.priceDeltaCents),
    );

    if (unitPriceCents < 0) {
      throw unprocessable(
        'NEGATIVE_UNIT_PRICE',
        `Selected modifiers price "${product.name}" below zero`,
        { itemIndex: index, unitPriceCents },
      );
    }

    const lineTotalCents = computeLineTotalCents(unitPriceCents, item.quantity);
    if (!isValidCents(lineTotalCents)) {
      throw unprocessable('LINE_TOTAL_OUT_OF_RANGE', 'Line total is out of the supported range', {
        itemIndex: index,
      });
    }

    return {
      productId: product.id,
      productName: product.name,
      productPriceCents: product.priceCents,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents,
      modifiers: selected,
    };
  });

  const subtotalCents = computeSubtotalCents(computedItems.map((i) => i.lineTotalCents));
  const taxCents = computeTaxCents(subtotalCents);
  const totalCents = subtotalCents + taxCents;

  if (!isValidCents(totalCents)) {
    throw unprocessable('TOTAL_OUT_OF_RANGE', 'Ticket total is out of the supported range');
  }

  return { items: computedItems, subtotalCents, taxCents, totalCents };
}

/** Rejects the ticket unless the client's arithmetic matches ours to the cent. */
export function assertTotalsMatch(
  computed: ComputedTicket,
  submitted: { subtotalCents: number; taxCents: number; totalCents: number },
): void {
  const mismatched =
    computed.subtotalCents !== submitted.subtotalCents ||
    computed.taxCents !== submitted.taxCents ||
    computed.totalCents !== submitted.totalCents;

  if (mismatched) {
    throw unprocessable(
      'TOTAL_MISMATCH',
      'Order total does not match. Please try again.',
      {
        expected: {
          subtotalCents: computed.subtotalCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
        },
        received: {
          subtotalCents: submitted.subtotalCents,
          taxCents: submitted.taxCents,
          totalCents: submitted.totalCents,
        },
      },
    );
  }
}
