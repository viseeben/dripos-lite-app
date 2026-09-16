/**
 * Minimal forward-only migration runner.
 *
 * - Applies every `migrations/*.sql` in lexical order, once, tracked in
 *   `schema_migrations`.
 * - Takes a Postgres advisory lock first, so N containers booting at the same
 *   time (a Railway rolling deploy) cannot race each other.
 * - Each file runs inside its own transaction: a failure rolls back cleanly and
 *   leaves the ledger untouched.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';
import { createPool } from './client.js';
import { env } from '../config/env.js';

/** Arbitrary but stable key, so only this app's migrations contend for the lock. */
const ADVISORY_LOCK_KEY = 4_812_003_117;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  pool: pg.Pool,
  log: (msg: string) => void = console.log,
): Promise<MigrationResult> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  if (files.length === 0) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      log(`[migrate] applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }

  log(`[migrate] ${applied.length} applied, ${skipped.length} already up to date`);
  return { applied, skipped };
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const pool = createPool(env().DATABASE_URL);
  try {
    await runMigrations(pool);
  } catch (err) {
    console.error('[migrate] FAILED:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
