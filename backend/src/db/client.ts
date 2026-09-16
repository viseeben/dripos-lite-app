import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema.js';

/**
 * `pg` parses INTEGER (oid 23) as a JS number already, but BIGINT (oid 20) and
 * NUMERIC (1700) arrive as strings. We never store money in those types; the
 * only bigint we read is `count(*)`, which we coerce explicitly at the call site.
 */

/**
 * Hosted Postgres (Railway's public proxy, Neon, Supabase, Heroku) terminates TLS
 * with a certificate that does not chain to a public root. Railway's *private*
 * network (`*.railway.internal`) and local dev need no TLS at all.
 */
function resolveSsl(databaseUrl: string): pg.ConnectionConfig['ssl'] {
  let host: string;
  let sslmode: string | null;
  try {
    const parsed = new URL(databaseUrl);
    host = parsed.hostname;
    sslmode = parsed.searchParams.get('sslmode');
  } catch {
    return undefined;
  }

  if (sslmode === 'disable') return undefined;

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.railway.internal') ||
    host.endsWith('.internal');

  if (isLocal && sslmode === null) return undefined;

  return { rejectUnauthorized: false };
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl: resolveSsl(databaseUrl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'dripos-lite-backend',
  });
}

export type Database = ReturnType<typeof createDb>;

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export { resolveSsl };
