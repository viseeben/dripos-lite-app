import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import type { Env } from '../config/env.js';
import { seed } from '../services/seed.js';
import { getSeedState, recordSeedFailure, recordSeedSuccess } from '../services/seed-state.js';
import { sql } from 'drizzle-orm';
import { HttpError } from '../utils/errors.js';

export const adminRoutes: FastifyPluginAsync<{ db: Database; env: Env }> = async (app, opts) => {
  const { db, env } = opts;

  /**
   * Re-imports the catalog. Idempotent.
   *
   * Guard: in production an ADMIN_TOKEN must be configured AND presented as a
   * bearer token. A production deployment without ADMIN_TOKEN set has the
   * endpoint disabled outright rather than left open.
   */
  app.post('/admin/seed', async (request, reply) => {
    if (env.NODE_ENV === 'production' && !env.ADMIN_TOKEN) {
      throw new HttpError(
        403,
        'SEED_DISABLED',
        'Seeding is disabled: set ADMIN_TOKEN to enable this endpoint in production.',
      );
    }

    if (env.ADMIN_TOKEN) {
      const header = request.headers.authorization ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
      if (presented !== env.ADMIN_TOKEN) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid admin token.');
      }
    }

    if (!env.MOCK_API_URL) {
      throw new HttpError(
        500,
        'MOCK_API_URL_NOT_CONFIGURED',
        'MOCK_API_URL is not set, so there is nothing to seed from.',
      );
    }

    try {
      const counts = await seed(db, env.MOCK_API_URL, (msg) => app.log.info(msg));
      recordSeedSuccess(counts);
      return reply.status(200).send(counts);
    } catch (err) {
      recordSeedFailure(err, env.MOCK_API_URL);
      throw err;
    }
  });

  /**
   * Plain GET so it can be opened in a browser. Reports what is actually in the
   * database and how the last seed went, which is enough to tell an empty menu
   * caused by "never seeded" apart from one caused by a mock API shape change.
   * Returns counts and a redacted error only — never credentials.
   */
  app.get('/admin/diagnostics', async () => {
    const counts = await db.execute<{
      products: number;
      modifierGroups: number;
      modifierOptions: number;
      tickets: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM products)          AS "products",
        (SELECT count(*)::int FROM modifier_groups)   AS "modifierGroups",
        (SELECT count(*)::int FROM modifier_options)  AS "modifierOptions",
        (SELECT count(*)::int FROM tickets)           AS "tickets"
    `);

    const catalog = counts.rows[0] ?? {
      products: 0,
      modifierGroups: 0,
      modifierOptions: 0,
      tickets: 0,
    };

    // Which migrations this instance has actually applied. A deploy that did
    // not land is otherwise indistinguishable from a bug in the app.
    const migrations = await db.execute<{ name: string }>(
      sql`SELECT name FROM schema_migrations ORDER BY name`,
    );

    return {
      ok: true,
      environment: env.NODE_ENV,
      // Which commit is actually serving. Without this, "the fix is deployed"
      // can only be inferred from behaviour, which is how a stale deploy ends
      // up being mistaken for a bug in the app.
      deployedCommit: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown',
      deployedBranch: env.RAILWAY_GIT_BRANCH ?? 'unknown',
      migrations: migrations.rows.map((r) => r.name),
      mockApiConfigured: Boolean(env.MOCK_API_URL),
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
      seedOnStart: env.SEED_ON_START,
      catalog,
      menuReady: catalog.products > 0,
      lastSeed: getSeedState() ?? null,
    };
  });
};
