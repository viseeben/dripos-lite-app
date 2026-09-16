import { createDb, createPool } from '../db/client.js';
import { env } from '../config/env.js';
import { seed } from '../services/seed.js';

const config = env();

if (!config.MOCK_API_URL) {
  console.error('MOCK_API_URL is not set. Add it to backend/.env and try again.');
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);

try {
  const counts = await seed(createDb(pool), config.MOCK_API_URL);
  console.log(JSON.stringify(counts, null, 2));
} catch (err) {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
