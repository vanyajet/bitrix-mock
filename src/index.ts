import { buildApp } from './app.js';
import { loadDotEnv, loadEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { createPool, waitForDb } from './db/pool.js';
import { createLogger } from './logger.js';

loadDotEnv();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, timeZone: env.APP_TZ, logger });
await waitForDb(pool, logger);
await runMigrations(pool, logger);

const app = await buildApp({ env, pool, logger });
await app.listen({ port: env.PORT, host: env.HOST });
logger.info({ mode: env.BITRIX_MODE, port: env.PORT }, 'server started');

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
