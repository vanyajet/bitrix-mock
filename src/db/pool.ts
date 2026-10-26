import pg from 'pg';
import type { Logger } from '../logger.js';

// count(*) и bigint-идентификаторы приходят строками; в наших объёмах они безопасно влезают в number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
// numeric(14,2) хранится в БД точно; в API отдаём числом (агрегаты уже посчитаны в SQL).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolOptions {
  connectionString: string;
  max: number;
  timeZone: string;
  logger: Logger;
}

export function createPool({ connectionString, max, timeZone, logger }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'crm-analytics',
  });
  // date_trunc по timestamptz (недели/месяцы) и границы дат считаются в часовом поясе бизнеса.
  // Запрос ставится в очередь клиента раньше любого пользовательского, поэтому применяется до него.
  pool.on('connect', (client) => {
    client.query("SELECT set_config('TimeZone', $1, false)", [timeZone]).catch((err: unknown) => {
      logger.error({ err }, 'failed to set session time zone');
    });
  });
  pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
  return pool;
}

export async function waitForDb(pool: pg.Pool, logger: Logger, attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ attempt: i, err: (err as Error).message }, 'database is not ready, retrying');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
