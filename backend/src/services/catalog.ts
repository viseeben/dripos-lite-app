/**
 * Menu reads.
 *
 * `listProducts` is deliberately ONE round trip: products, their modifier
 * groups, and each group's options are assembled server-side with lateral
 * json aggregation. Adding a product never adds a query.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { ProductDto } from '../types/index.js';

export async function listProducts(db: Database): Promise<ProductDto[]> {
  const result = await db.execute<ProductDto>(sql`
    SELECT
      p.id,
      p.name,
      p.price_cents AS "priceCents",
      COALESCE(grp.groups, '[]'::json) AS "modifierGroups"
    FROM products p
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'id',       mg.id,
                 'name',     mg.name,
                 'required', mg.required,
                 'options',  COALESCE(opt.options, '[]'::json)
               )
               ORDER BY pmg.sort_order, mg.name
             ) AS groups
      FROM product_modifier_groups pmg
      JOIN modifier_groups mg ON mg.id = pmg.modifier_group_id
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object(
                   'id',              mo.id,
                   'name',            mo.name,
                   'priceDeltaCents', mo.price_delta_cents
                 )
                 ORDER BY mo.sort_order, mo.name
               ) AS options
        FROM modifier_options mo
        WHERE mo.modifier_group_id = mg.id
      ) opt ON TRUE
      WHERE pmg.product_id = p.id
    ) grp ON TRUE
    ORDER BY p.sort_order, p.name
  `);

  return result.rows;
}
