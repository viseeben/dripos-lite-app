import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import type { Env } from '../config/env.js';
import { seed } from '../services/seed.js';
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

    const counts = await seed(db, env.MOCK_API_URL, (msg) => app.log.info(msg));
    return reply.status(200).send(counts);
  });
};
