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

/**
 * Клиент, который сразу после подключения выставляет часовой пояс сессии: date_trunc по timestamptz
 * (недели/месяцы) и границы периодов считаются в часовом поясе бизнеса. Пул получает клиента только
 * после set_config, поэтому ни один запрос не выполнится в UTC. Работает на любом Postgres (без
 * стартового параметра options), но требует прямого соединения - как и session-level advisory lock.
 */
type ConnectCallback = ((err: Error) => void) | ((err: null, client: pg.Client) => void);

function clientWithTimeZone(timeZone: string, onError: (err: Error) => void): typeof pg.Client {
  return class TimeZoneClient extends pg.Client {
    constructor(config?: string | pg.ClientConfig) {
      super(config);
      // Обрыв соединения у выданного из пула клиента без слушателя 'error' роняет процесс.
      // Ошибка активного запроса всё равно придёт в его промис; здесь - только страховка.
      this.on('error', (err) => onError(err));
    }

    override connect(): Promise<pg.Client>;
    override connect(callback: ConnectCallback): void;
    override connect(callback?: ConnectCallback): Promise<pg.Client> | void {
      const ready = super
        .connect()
        .then(() => super.query("SELECT set_config('TimeZone', $1, false)", [timeZone]))
        .then((): pg.Client => this);
      if (!callback) return ready;
      const cb = callback as (err: Error | null, client?: pg.Client) => void;
      ready.then(
        (client) => cb(null, client),
        (err: Error) => cb(err),
      );
    }
  };
}

export function createPool({ connectionString, max, timeZone, logger }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    // с запасом: на слабом CPU (бесплатные инстансы) рукопожатие TLS и event loop бывают медленными
    connectionTimeoutMillis: 30_000,
    application_name: 'crm-analytics',
    Client: clientWithTimeZone(timeZone, (err) => logger.warn({ err: err.message }, 'postgres client error')),
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
