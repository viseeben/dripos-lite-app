import { createDb, createPool } from './db/client.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './services/seed.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = env();
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);

  if (config.RUN_MIGRATIONS_ON_START) {
    await runMigrations(pool);
  }

  const app = await buildApp(db, config);

  // Seeding is opt-in: it costs an outbound fetch on every cold start, and the
  // catalog rarely changes. Failure here must not take the server down.
  if (config.SEED_ON_START) {
    if (config.MOCK_API_URL) {
      try {
        await seed(db, config.MOCK_API_URL, (msg) => app.log.info(msg));
      } catch (err) {
        app.log.error({ err }, 'startup seed failed; continuing to serve');
      }
    } else {
      app.log.warn('SEED_ON_START is true but MOCK_API_URL is not set; skipping seed');
    }
  }

  // Bind all interfaces: Railway (and every other PaaS) routes to the container
  // IP, so listening on localhost would make the service unreachable.
  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
