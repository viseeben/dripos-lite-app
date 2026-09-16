import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  /** Liveness. Deliberately does not touch the database. */
  app.get('/health', async () => ({ ok: true }));

  /** Readiness: proves the database is actually reachable. */
  app.get('/health/ready', async (_request, reply) => {
    try {
      await opts.db.execute(sql`SELECT 1`);
      return { ok: true, database: 'up' };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed');
      return reply.status(503).send({ error: 'Database unavailable', code: 'DATABASE_UNAVAILABLE' });
    }
  });
};
