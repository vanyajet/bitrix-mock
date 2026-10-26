import type { Env } from './config/env.js';
import type { Pool } from './db/pool.js';
import type { Logger } from './logger.js';

/** Зависимости, которые прокидываются в роуты и сервисы (без глобальных синглтонов - удобно в тестах). */
export interface AppContext {
  env: Env;
  pool: Pool;
  logger: Logger;
}
