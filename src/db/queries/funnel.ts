import type { Period } from '../../api/params.js';
import type { Pool } from '../pool.js';

export interface FunnelStepRow {
  stage: string;
  rank: number;
  reached: number;
  lostNoAnswer: number;
  lostRejected: number;
  inProgress: number;
  conversionFromPrevPct: number | null;
  conversionFromStartPct: number | null;
  avgHoursOnStage: number | null;
  totalLostNoAnswer: number;
  totalLostRejected: number;
  totalInProgress: number;
}

/**
 * Воронка когорты лидов периода. Для каждого лида берётся самая дальняя стадия, до которой он дошёл
 * (по истории стадий лида и его сделки + текущему состоянию на случай пустой истории).
 * Потери шага - лиды, дошедшие до шага и завершившиеся неудачей на нём.
 * Время на стадии - по истории: от входа в стадию до перехода в следующую (подряд идущие
 * стадии Bitrix с одной канонической стадией склеиваются).
 */
export async function funnel(pool: Pool, p: Period): Promise<FunnelStepRow[]> {
  const { rows } = await pool.query<FunnelStepRow>(
    `WITH cohort AS (
       SELECT bitrix_id, stage
       FROM leads
       WHERE vertical = $1 AND created_at >= $2::date AND created_at < $3::date + 1 AND ($4::text IS NULL OR segment = $4)
     ),
     deal AS (
       SELECT DISTINCT ON (d.lead_id) d.lead_id, d.bitrix_id, d.stage
       FROM deals d JOIN cohort c ON c.bitrix_id = d.lead_id
       ORDER BY d.lead_id, d.created_at DESC
     ),
     points AS (
       SELECT c.bitrix_id AS lead_id, h.stage FROM cohort c
       JOIN stage_history h ON h.entity_type = 'lead' AND h.owner_id = c.bitrix_id
       UNION ALL SELECT bitrix_id, stage FROM cohort
       UNION ALL
       SELECT dl.lead_id, h.stage FROM deal dl
       JOIN stage_history h ON h.entity_type = 'deal' AND h.owner_id = dl.bitrix_id
       UNION ALL SELECT lead_id, stage FROM deal
     ),
     reached AS (
       SELECT lead_id,
              max(CASE stage WHEN 'IN_PROGRESS' THEN 2 WHEN 'QUALIFIED' THEN 3 WHEN 'MEETING' THEN 4 WHEN 'WON' THEN 5 ELSE 1 END) AS max_rank
       FROM points GROUP BY lead_id
     ),
     outcome AS (
       SELECT r.max_rank,
              CASE WHEN dl.stage = 'WON' THEN 'won'
                   WHEN dl.stage = 'LOST' THEN 'rejected'
                   WHEN dl.lead_id IS NULL AND c.stage = 'NO_ANSWER' THEN 'no_answer'
                   WHEN dl.lead_id IS NULL AND c.stage = 'LOST' THEN 'rejected'
                   ELSE 'open' END AS outcome
       FROM cohort c
       JOIN reached r ON r.lead_id = c.bitrix_id
       LEFT JOIN deal dl ON dl.lead_id = c.bitrix_id
     ),
     steps(stage, rank) AS (
       VALUES ('NEW', 1), ('IN_PROGRESS', 2), ('QUALIFIED', 3), ('MEETING', 4), ('WON', 5)
     ),
     counts AS (
       SELECT s.stage, s.rank,
              count(o.max_rank) FILTER (WHERE o.max_rank >= s.rank)                           AS reached,
              count(o.max_rank) FILTER (WHERE o.max_rank = s.rank AND o.outcome = 'no_answer') AS lost_no_answer,
              count(o.max_rank) FILTER (WHERE o.max_rank = s.rank AND o.outcome = 'rejected')  AS lost_rejected,
              count(o.max_rank) FILTER (WHERE o.max_rank = s.rank AND o.outcome = 'open')      AS in_progress
       FROM steps s LEFT JOIN outcome o ON true
       GROUP BY s.stage, s.rank
     ),
     events AS (
       SELECT 'lead' AS entity, h.owner_id, h.stage, h.created_at
       FROM stage_history h JOIN cohort c ON h.entity_type = 'lead' AND h.owner_id = c.bitrix_id
       UNION ALL
       SELECT 'deal', h.owner_id, h.stage, h.created_at
       FROM stage_history h JOIN deal dl ON h.entity_type = 'deal' AND h.owner_id = dl.bitrix_id
     ),
     entries AS (
       SELECT entity, owner_id, stage, created_at,
              lag(stage) OVER (PARTITION BY entity, owner_id ORDER BY created_at) AS prev_stage
       FROM events
     ),
     durations AS (
       SELECT stage, created_at,
              lead(created_at) OVER (PARTITION BY entity, owner_id ORDER BY created_at) AS left_at
       FROM entries
       WHERE prev_stage IS DISTINCT FROM stage
     ),
     avg_time AS (
       SELECT stage, round((avg(extract(epoch FROM left_at - created_at)) / 3600.0)::numeric, 1) AS avg_hours
       FROM durations WHERE left_at IS NOT NULL
       GROUP BY stage
     )
     SELECT c.stage, c.rank, c.reached,
            c.lost_no_answer AS "lostNoAnswer",
            c.lost_rejected  AS "lostRejected",
            c.in_progress    AS "inProgress",
            round(100.0 * c.reached / NULLIF(lag(c.reached) OVER (ORDER BY c.rank), 0), 1)          AS "conversionFromPrevPct",
            round(100.0 * c.reached / NULLIF(first_value(c.reached) OVER (ORDER BY c.rank), 0), 1)  AS "conversionFromStartPct",
            CASE WHEN c.stage = 'WON' THEN NULL ELSE t.avg_hours END                                AS "avgHoursOnStage",
            sum(c.lost_no_answer) OVER ()                                                           AS "totalLostNoAnswer",
            sum(c.lost_rejected) OVER ()                                                            AS "totalLostRejected",
            sum(c.in_progress) OVER ()                                                              AS "totalInProgress"
     FROM counts c
     LEFT JOIN avg_time t ON t.stage = c.stage
     ORDER BY c.rank`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}
