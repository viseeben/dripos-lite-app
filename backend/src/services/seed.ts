/**
 * Catalog seed: pulls products + modifier groups from the Dripos mock API and
 * upserts them.
 *
 * Two deliberate design choices:
 *
 * 1. Fetching is separated from transforming (`fetchMockCatalog` vs
 *    `normalizeCatalog` vs `applyCatalog`) so the transform is unit-testable
 *    with no network, and so a shape surprise fails with a readable message
 *    instead of a crash three layers down.
 *
 * 2. Conflicts UPDATE rather than DO NOTHING. Re-running the seed after a menu
 *    change should actually refresh the menu. This is safe because tickets
 *    snapshot product/modifier names and prices at order time, so historical
 *    receipts never change retroactively.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  modifierGroups,
  modifierOptions,
  productModifierGroups,
  products,
} from '../db/schema.js';

/* ------------------------------------------------------------ canonical shape */

export interface CanonicalOption {
  externalId: string;
  name: string;
  priceDeltaCents: number;
}

export interface CanonicalGroup {
  externalId: string;
  name: string;
  required: boolean;
  options: CanonicalOption[];
}

export interface CanonicalProduct {
  externalId: string;
  name: string;
  priceCents: number;
  modifierGroupExternalIds: string[];
}

export interface CanonicalCatalog {
  products: CanonicalProduct[];
  modifierGroups: CanonicalGroup[];
}

export interface SeedCounts {
  products: number;
  modifierGroups: number;
  modifierOptions: number;
}

/* --------------------------------------------------------------- normalising */

class ShapeError extends Error {
  constructor(where: string, received: unknown) {
    const preview = JSON.stringify(received)?.slice(0, 300) ?? String(received);
    super(`Unrecognised mock API shape at ${where}. Received: ${preview}`);
    this.name = 'ShapeError';
  }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Mock APIs wrap collections in all sorts of envelopes; unwrap the common ones. */
function asArray(value: unknown, where: string): Json[] {
  const candidate = Array.isArray(value)
    ? value
    : isObject(value)
      ? (['data', 'products', 'items', 'results', 'modifierGroups', 'modifier_groups'] as const)
          .map((k) => value[k])
          .find(Array.isArray)
      : undefined;

  if (!Array.isArray(candidate)) throw new ShapeError(where, value);
  return candidate.filter(isObject);
}

function pickString(source: Json, keys: readonly string[], where: string): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  throw new ShapeError(`${where} (expected one of: ${keys.join(', ')})`, source);
}

/**
 * Money may arrive as integer cents (`priceCents`) or as decimal dollars
 * (`price: 4.5`). Cents keys win; a dollars key is converted once, here.
 */
function pickCents(
  source: Json,
  centsKeys: readonly string[],
  dollarKeys: readonly string[],
  fallback: number | null,
): number {
  for (const key of centsKeys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  }
  for (const key of dollarKeys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Math.round(Number(value) * 100);
    }
  }
  if (fallback !== null) return fallback;
  throw new ShapeError(`price (expected one of: ${[...centsKeys, ...dollarKeys].join(', ')})`, source);
}

function pickBoolean(source: Json, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return false;
}

function normalizeOption(raw: Json): CanonicalOption {
  return {
    externalId: pickString(raw, ['id', '_id', 'externalId', 'optionId'], 'modifier option id'),
    name: pickString(raw, ['name', 'title', 'label'], 'modifier option name'),
    priceDeltaCents: pickCents(
      raw,
      ['priceDeltaCents', 'price_delta_cents', 'priceDelta', 'price_delta'],
      ['price', 'priceDelta', 'amount'],
      0,
    ),
  };
}

export function normalizeGroup(raw: Json): CanonicalGroup {
  const rawOptions = raw['options'] ?? raw['modifierOptions'] ?? raw['modifiers'] ?? raw['choices'];
  return {
    externalId: pickString(raw, ['id', '_id', 'externalId', 'groupId'], 'modifier group id'),
    name: pickString(raw, ['name', 'title', 'label'], 'modifier group name'),
    required: pickBoolean(raw, ['required', 'isRequired', 'is_required', 'mandatory']),
    options: Array.isArray(rawOptions) ? rawOptions.filter(isObject).map(normalizeOption) : [],
  };
}

export function normalizeProduct(raw: Json): CanonicalProduct {
  const rawGroups =
    raw['modifierGroupIds'] ??
    raw['modifier_group_ids'] ??
    raw['modifierGroups'] ??
    raw['modifier_groups'] ??
    [];

  const modifierGroupExternalIds = Array.isArray(rawGroups)
    ? rawGroups
        .map((g) => {
          if (typeof g === 'string') return g;
          if (typeof g === 'number') return String(g);
          if (isObject(g)) return pickString(g, ['id', '_id', 'externalId', 'groupId'], 'group ref');
          return null;
        })
        .filter((g): g is string => g !== null)
    : [];

  return {
    externalId: pickString(raw, ['id', '_id', 'externalId', 'productId'], 'product id'),
    name: pickString(raw, ['name', 'title', 'label'], 'product name'),
    priceCents: pickCents(
      raw,
      ['priceCents', 'price_cents', 'basePriceCents'],
      ['price', 'basePrice', 'amount'],
      null,
    ),
    modifierGroupExternalIds,
  };
}

/**
 * Builds the canonical catalog. Modifier groups may arrive from their own
 * endpoint or inlined on products; both are supported, and inlined groups are
 * merged in so a product never references a group we did not store.
 */
export function normalizeCatalog(rawProducts: unknown, rawGroups: unknown): CanonicalCatalog {
  const productList = asArray(rawProducts, 'products');
  const groupList = rawGroups === undefined || rawGroups === null ? [] : asArray(rawGroups, 'modifier groups');

  const byExternalId = new Map<string, CanonicalGroup>();
  for (const raw of groupList) {
    const group = normalizeGroup(raw);
    byExternalId.set(group.externalId, group);
  }

  // Pick up groups that were inlined on products rather than listed separately.
  for (const raw of productList) {
    const inlined = raw['modifierGroups'] ?? raw['modifier_groups'];
    if (!Array.isArray(inlined)) continue;
    for (const candidate of inlined.filter(isObject)) {
      if (!('options' in candidate || 'modifiers' in candidate || 'modifierOptions' in candidate)) continue;
      const group = normalizeGroup(candidate);
      if (!byExternalId.has(group.externalId)) byExternalId.set(group.externalId, group);
    }
  }

  const known = new Set(byExternalId.keys());
  const normalizedProducts = productList.map(normalizeProduct).map((product) => ({
    ...product,
    // Drop dangling references rather than failing the whole seed on one bad row.
    modifierGroupExternalIds: product.modifierGroupExternalIds.filter((id) => known.has(id)),
  }));

  return { products: normalizedProducts, modifierGroups: [...byExternalId.values()] };
}

/* ----------------------------------------------------------------- fetching */

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`GET ${url} responded ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * Fetches products and modifier groups. The mock API's exact paths are
 * configurable; the defaults follow the assessment spec. If the modifier-group
 * endpoint is absent we continue with whatever was inlined on products.
 */
export async function fetchMockCatalog(
  baseUrl: string,
  options: {
    productsPath?: string;
    modifierGroupsPath?: string;
    timeoutMs?: number;
    log?: (msg: string) => void;
  } = {},
): Promise<CanonicalCatalog> {
  const base = trimSlash(baseUrl);
  const productsPath = options.productsPath ?? '/products';
  const groupsPath = options.modifierGroupsPath ?? '/modifier-groups';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const log = options.log ?? (() => undefined);

  const rawProducts = await getJson(`${base}${productsPath}`, timeoutMs);

  let rawGroups: unknown;
  try {
    rawGroups = await getJson(`${base}${groupsPath}`, timeoutMs);
  } catch (err) {
    log(`[seed] ${groupsPath} unavailable (${(err as Error).message}); using groups inlined on products`);
    rawGroups = undefined;
  }

  return normalizeCatalog(rawProducts, rawGroups);
}

/* ------------------------------------------------------------------ applying */

export async function applyCatalog(db: Database, catalog: CanonicalCatalog): Promise<SeedCounts> {
  const { products: productList, modifierGroups: groupList } = catalog;

  return db.transaction(async (tx) => {
    let groupIdByExternalId = new Map<string, string>();

    if (groupList.length > 0) {
      await tx
        .insert(modifierGroups)
        .values(groupList.map((g) => ({ externalId: g.externalId, name: g.name, required: g.required })))
        .onConflictDoUpdate({
          target: modifierGroups.externalId,
          set: { name: sql`excluded.name`, required: sql`excluded.required` },
        });

      const rows = await tx
        .select({ id: modifierGroups.id, externalId: modifierGroups.externalId })
        .from(modifierGroups);
      groupIdByExternalId = new Map(rows.map((r) => [r.externalId, r.id]));
    }

    const optionValues = groupList.flatMap((group) => {
      const groupId = groupIdByExternalId.get(group.externalId);
      if (!groupId) return [];
      return group.options.map((option, index) => ({
        externalId: option.externalId,
        modifierGroupId: groupId,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        sortOrder: index,
      }));
    });

    if (optionValues.length > 0) {
      await tx
        .insert(modifierOptions)
        .values(optionValues)
        .onConflictDoUpdate({
          target: modifierOptions.externalId,
          set: {
            name: sql`excluded.name`,
            priceDeltaCents: sql`excluded.price_delta_cents`,
            sortOrder: sql`excluded.sort_order`,
            modifierGroupId: sql`excluded.modifier_group_id`,
          },
        });
    }

    let productIdByExternalId = new Map<string, string>();

    if (productList.length > 0) {
      await tx
        .insert(products)
        .values(
          productList.map((p, index) => ({
            externalId: p.externalId,
            name: p.name,
            priceCents: p.priceCents,
            sortOrder: index,
          })),
        )
        .onConflictDoUpdate({
          target: products.externalId,
          set: {
            name: sql`excluded.name`,
            priceCents: sql`excluded.price_cents`,
            sortOrder: sql`excluded.sort_order`,
          },
        });

      const rows = await tx
        .select({ id: products.id, externalId: products.externalId })
        .from(products);
      productIdByExternalId = new Map(rows.map((r) => [r.externalId, r.id]));
    }

    const junctionValues = productList.flatMap((product) => {
      const productId = productIdByExternalId.get(product.externalId);
      if (!productId) return [];
      return product.modifierGroupExternalIds.flatMap((externalId, index) => {
        const modifierGroupId = groupIdByExternalId.get(externalId);
        return modifierGroupId ? [{ productId, modifierGroupId, sortOrder: index }] : [];
      });
    });

    if (junctionValues.length > 0) {
      await tx
        .insert(productModifierGroups)
        .values(junctionValues)
        .onConflictDoUpdate({
          target: [productModifierGroups.productId, productModifierGroups.modifierGroupId],
          set: { sortOrder: sql`excluded.sort_order` },
        });
    }

    return {
      products: productList.length,
      modifierGroups: groupList.length,
      modifierOptions: optionValues.length,
    };
  });
}

export async function seed(
  db: Database,
  baseUrl: string,
  log: (msg: string) => void = console.log,
): Promise<SeedCounts> {
  log(`[seed] fetching catalog from ${baseUrl}`);
  const catalog = await fetchMockCatalog(baseUrl, { log });
  log(
    `[seed] normalised ${catalog.products.length} products, ` +
      `${catalog.modifierGroups.length} modifier groups`,
  );
  const counts = await applyCatalog(db, catalog);
  log(`[seed] done: ${JSON.stringify(counts)}`);
  return counts;
}
