import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Database } from './db/client.js';
import type { Env } from './config/env.js';
import { HttpError } from './utils/errors.js';
import { healthRoutes } from './routes/health.js';
import { productRoutes } from './routes/products.js';
import { ticketRoutes } from './routes/tickets.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp(db: Database, env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // Railway/Fly terminate TLS upstream; trust the forwarding headers.
    trustProxy: true,
  });

  // The assessment spec calls for permissive CORS; the app has no cookies or
  // credentials, so there is nothing for a cross-origin caller to steal.
  await app.register(cors, { origin: true });

  /** Every error leaves the API as `{ error, code, ...context }`. */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      request.log.info({ code: error.code, status: error.statusCode }, error.message);
      return reply.status(error.statusCode).send(error.toBody());
    }

    // Malformed JSON and unsupported content types arrive as Fastify errors.
    const candidate = error as { statusCode?: unknown; message?: unknown; code?: unknown };
    const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : 500;
    if (status >= 400 && status < 500) {
      return reply.status(status).send({
        error: typeof candidate.message === 'string' ? candidate.message : 'Bad request',
        code: typeof candidate.code === 'string' ? candidate.code : 'BAD_REQUEST',
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: 'Something went wrong on our end.',
      code: 'INTERNAL_ERROR',
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: `Route ${request.method} ${request.url} not found`,
      code: 'ROUTE_NOT_FOUND',
    }),
  );

  await app.register(healthRoutes, { db });
  await app.register(productRoutes, { db });
  await app.register(ticketRoutes, { db });
  await app.register(adminRoutes, { db, env });

  return app;
}
