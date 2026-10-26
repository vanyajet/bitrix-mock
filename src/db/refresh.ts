import type { Logger } from '../logger.js';
import type { Pool } from './pool.js';

export const MATERIALIZED_VIEWS = ['mv_source_monthly', 'mv_manager_monthly'] as const;

/** CONCURRENTLY не блокирует чтение дашборда на время пересчёта. */
export async function refreshMaterializedViews(pool: Pool, logger: Logger): Promise<void> {
  for (const view of MATERIALIZED_VIEWS) {
    const started = Date.now();
    await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
    logger.debug({ view, ms: Date.now() - started }, 'materialized view refreshed');
  }
}
