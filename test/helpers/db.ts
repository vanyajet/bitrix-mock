import pino from 'pino';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool, type Pool } from '../../src/db/pool.js';
import type { Logger } from '../../src/logger.js';
import { TEST_DATABASE_URL } from './config.js';

export const silentLogger: Logger = pino({ level: 'silent' });

export function createTestPool(): Pool {
  return createPool({ connectionString: TEST_DATABASE_URL, max: 5, timeZone: 'Europe/Moscow', logger: silentLogger });
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool, silentLogger);
}

/** Отпечаток таблицы: число строк + md5 всех значений (кроме служебного synced_at) в порядке PK. */
export async function tableFingerprint(pool: Pool, table: string, orderBy: string): Promise<{ count: number; hash: string }> {
  const { rows: cols } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name <> 'synced_at' ORDER BY ordinal_position`,
    [table],
  );
  const list = cols.map((c) => c.column_name).join(', ');
  const { rows } = await pool.query<{ count: number; hash: string }>(
    `SELECT count(*)::int AS count, md5(coalesce(string_agg(t::text, '|' ORDER BY ${orderBy}), '')) AS hash
     FROM (SELECT ${list} FROM ${table}) t`,
  );
  return rows[0]!;
}
