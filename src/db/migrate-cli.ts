import { loadDotEnv, loadEnv } from '../config/env.js';
import { createLogger } from '../logger.js';
import { runMigrations } from './migrate.js';
import { createPool } from './pool.js';

loadDotEnv();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2, timeZone: env.APP_TZ, logger });

try {
  const applied = await runMigrations(pool, logger);
  logger.info({ applied }, applied.length ? 'migrations applied' : 'schema is up to date');
} finally {
  await pool.end();
}
