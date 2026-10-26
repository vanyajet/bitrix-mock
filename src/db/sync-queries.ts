import type { Pool } from './pool.js';

/** Время окончания последнего прогона, в котором все сущности синкнулись успешно. */
export async function lastSuccessfulSyncAt(pool: Pool): Promise<Date | null> {
  const { rows } = await pool.query<{ finished_at: Date }>(`
    SELECT max(finished_at) AS finished_at
    FROM sync_runs
    GROUP BY run_id
    HAVING bool_and(status = 'success')
    ORDER BY max(started_at) DESC
    LIMIT 1`);
  return rows[0]?.finished_at ?? null;
}
