import { buildApp } from './app.js';
import { loadDotEnv, loadEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { createPool, waitForDb } from './db/pool.js';
import { createLogger } from './logger.js';
import { seedPlans } from './mock/plans.js';
import { MockStore } from './mock/store.js';

loadDotEnv();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, timeZone: env.APP_TZ, logger });
await waitForDb(pool, logger);
await runMigrations(pool, logger);

const mockStore = env.BITRIX_MODE === 'mock' ? new MockStore({ seed: env.MOCK_SEED }) : undefined;
if (mockStore) {
  const inserted = await seedPlans(pool);
  if (inserted > 0) logger.info({ inserted }, 'revenue plans seeded');
}

const app = await buildApp({ env, pool, logger, mockStore });
await app.listen({ port: env.PORT, host: env.HOST });
logger.info({ mode: env.BITRIX_MODE, port: env.PORT }, 'server started');

if (mockStore) {
  // Генерация истории портала после listen: health-check отвечает сразу, даже на медленном CPU.
  const started = Date.now();
  const stats = mockStore.stats();
  logger.info({ ...stats, ms: Date.now() - started }, 'mock Bitrix24 portal generated');
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await app.close();
    await pool.end();
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
