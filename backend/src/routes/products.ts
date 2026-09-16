import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { listProducts } from '../services/catalog.js';

export const productRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  app.get('/products', async () => listProducts(opts.db));
};
