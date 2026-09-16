/**
 * Seeds from `fixtures/mock-catalog.json` instead of the network.
 *
 * Runs the exact same normalise + upsert path as the real seed, so it both
 * populates a local database and exercises the seed code offline.
 *
 *   npm run seed:fixture
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '../db/client.js';
import { env } from '../config/env.js';
import { applyCatalog, normalizeCatalog } from '../services/seed.js';

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'mock-catalog.json',
);

const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as {
  products: unknown;
  modifierGroups: unknown;
};

const catalog = normalizeCatalog(raw.products, raw.modifierGroups);
const pool = createPool(env().DATABASE_URL);

try {
  const counts = await applyCatalog(createDb(pool), catalog);
  console.log('[seed:fixture]', JSON.stringify(counts));
} catch (err) {
  console.error('[seed:fixture] FAILED:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
