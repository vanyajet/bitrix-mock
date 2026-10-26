import type { Pool } from '../pool.js';

export interface SyncEntityStatus {
  entity: string;
  status: string;
  fetched: number;
  upserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncRunSummary {
  runId: string;
  trigger: string;
  status: 'running' | 'success' | 'failed' | 'aborted';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  fetched: number;
  upserted: number;
  error: string | null;
  entities: SyncEntityStatus[];
}

/** Последние прогоны, агрегированные по run_id (в sync_runs строка на сущность). */
export async function recentRuns(pool: Pool, limit = 10): Promise<SyncRunSummary[]> {
  const { rows } = await pool.query<SyncRunSummary>(
    `WITH runs AS (
       SELECT run_id, min(started_at) AS started_at
       FROM sync_runs GROUP BY run_id ORDER BY started_at DESC LIMIT $1
     )
     SELECT r.run_id AS "runId",
            min(s.trigger) AS trigger,
            CASE WHEN bool_or(s.status = 'running') THEN 'running'
                 WHEN bool_or(s.status = 'failed') THEN 'failed'
                 WHEN bool_or(s.status = 'aborted') THEN 'aborted'
                 ELSE 'success' END AS status,
            r.started_at AS "startedAt",
            CASE WHEN bool_or(s.status = 'running') THEN NULL ELSE max(s.finished_at) END AS "finishedAt",
            CASE WHEN bool_or(s.status = 'running') THEN NULL
                 ELSE round(extract(epoch FROM max(s.finished_at) - r.started_at) * 1000)::int END AS "durationMs",
            sum(s.fetched)::int AS fetched,
            sum(s.upserted)::int AS upserted,
            string_agg(s.entity || ': ' || s.error, '; ') FILTER (WHERE s.error IS NOT NULL) AS error,
            json_agg(json_build_object(
              'entity', s.entity, 'status', s.status, 'fetched', s.fetched, 'upserted', s.upserted,
              'error', s.error, 'startedAt', s.started_at, 'finishedAt', s.finished_at) ORDER BY s.id) AS entities
     FROM runs r JOIN sync_runs s USING (run_id)
     GROUP BY r.run_id, r.started_at
     ORDER BY r.started_at DESC`,
    [limit],
  );
  return rows;
}

export async function syncCursors(pool: Pool): Promise<Array<{ entity: string; lastModified: string | null; updatedAt: string }>> {
  const { rows } = await pool.query(
    `SELECT entity, last_modified AS "lastModified", updated_at AS "updatedAt" FROM sync_state ORDER BY entity`,
  );
  return rows;
}

export async function dataTotals(pool: Pool): Promise<{ leads: number; deals: number; history: number; adSpendDays: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM leads)::int         AS leads,
            (SELECT count(*) FROM deals)::int         AS deals,
            (SELECT count(*) FROM stage_history)::int AS history,
            (SELECT count(DISTINCT date) FROM ad_spend)::int AS "adSpendDays"`,
  );
  return rows[0];
}
