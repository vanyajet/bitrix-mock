import type { ScheduledTask } from 'node-cron';
import { buildApp } from './app.js';
import { loadDotEnv, loadEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { createPool, waitForDb } from './db/pool.js';
import { createLogger } from './logger.js';
import { seedPlans } from './mock/plans.js';
import { MockStore } from './mock/store.js';
import { createSyncService } from './sync/index.js';
import { startScheduler } from './sync/scheduler.js';
import { SyncAlreadyRunningError } from './sync/worker.js';

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

const sync = createSyncService(env, pool, logger);
const app = await buildApp({ env, pool, logger, mockStore, sync });
await app.listen({ port: env.PORT, host: env.HOST });
logger.info({ mode: env.BITRIX_MODE, port: env.PORT }, 'server started');

if (mockStore) {
  // Генерация истории портала после listen: health-check отвечает сразу, даже на медленном CPU.
  const started = Date.now();
  const stats = mockStore.stats();
  logger.info({ ...stats, ms: Date.now() - started }, 'mock Bitrix24 portal generated');
}

let scheduler: ScheduledTask | null = null;
if (env.SYNC_ON_START) {
  sync.run('startup').catch((err) => {
    if (!(err instanceof SyncAlreadyRunningError)) logger.error({ err }, 'startup sync failed');
  });
}
scheduler = startScheduler(sync, env.SYNC_INTERVAL_MIN, logger);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out');
    process.exit(1);
  }, 25_000).unref();
  try {
    await scheduler?.stop();
    await sync.stop(); // дописывает текущую пачку и помечает прогон aborted
    await app.close();
    await pool.end();
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
