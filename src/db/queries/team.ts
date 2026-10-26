import type { Period } from '../../api/params.js';
import type { Pool } from '../pool.js';

export interface TeamMemberRow {
  id: number;
  name: string;
  position: string | null;
  leads: number;
  wonCohort: number;
  wonDeals: number;
  revenue: number;
  conversionPct: number | null;
  avgCheck: number | null;
  avgResponseMin: number | null;
  medianResponseMin: number | null;
  noAnswerPct: number | null;
  revenueSharePct: number | null;
  revenueRank: number;
}

/**
 * По каждому специалисту: лиды и конверсия - по лидам, полученным в периоде; выручка и чек - по сделкам,
 * закрытым в периоде. Скорость обработки - время от создания лида до первого перехода из NEW
 * (по истории стадий): среднее и медиана, т.к. ночные заявки сильно тянут среднее.
 */
export async function teamStats(pool: Pool, p: Period): Promise<TeamMemberRow[]> {
  const { rows } = await pool.query<TeamMemberRow>(
    `WITH cohort AS (
       SELECT l.assigned_user_id                                            AS uid,
              count(DISTINCT l.bitrix_id)                                   AS leads,
              count(DISTINCT d.bitrix_id) FILTER (WHERE d.is_won)           AS won_cohort,
              count(DISTINCT l.bitrix_id) FILTER (WHERE l.stage = 'NO_ANSWER') AS no_answer
       FROM leads l
       LEFT JOIN deals d ON d.lead_id = l.bitrix_id
       WHERE l.vertical = $1 AND l.created_at >= $2::date AND l.created_at < $3::date + 1 AND ($4::text IS NULL OR l.segment = $4)
       GROUP BY 1
     ),
     closed AS (
       SELECT assigned_user_id AS uid, count(*) AS won_deals, sum(amount) AS revenue
       FROM deals
       WHERE is_won AND vertical = $1 AND closed_at >= $2::date AND closed_at < $3::date + 1 AND ($4::text IS NULL OR segment = $4)
       GROUP BY 1
     ),
     response AS (
       SELECT l.assigned_user_id AS uid,
              avg(extract(epoch FROM ft.first_touch - l.created_at)) / 60.0                                    AS avg_min,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ft.first_touch - l.created_at)) / 60.0 AS median_min
       FROM leads l
       CROSS JOIN LATERAL (
         SELECT min(h.created_at) AS first_touch
         FROM stage_history h
         WHERE h.entity_type = 'lead' AND h.owner_id = l.bitrix_id AND h.stage <> 'NEW'
       ) ft
       WHERE ft.first_touch IS NOT NULL
         AND l.vertical = $1 AND l.created_at >= $2::date AND l.created_at < $3::date + 1 AND ($4::text IS NULL OR l.segment = $4)
       GROUP BY 1
     ),
     joined AS (
       SELECT u.bitrix_id AS id, u.name, u.position,
              coalesce(c.leads, 0) AS leads, coalesce(c.won_cohort, 0) AS won_cohort, coalesce(c.no_answer, 0) AS no_answer,
              coalesce(x.won_deals, 0) AS won_deals, coalesce(x.revenue, 0) AS revenue,
              r.avg_min, r.median_min
       FROM users u
       LEFT JOIN cohort c ON c.uid = u.bitrix_id
       LEFT JOIN closed x ON x.uid = u.bitrix_id
       LEFT JOIN response r ON r.uid = u.bitrix_id
       WHERE c.uid IS NOT NULL OR x.uid IS NOT NULL
     )
     SELECT id, name, position, leads,
            won_cohort                                                          AS "wonCohort",
            won_deals                                                           AS "wonDeals",
            revenue,
            round(100.0 * won_cohort / NULLIF(leads, 0), 1)                     AS "conversionPct",
            round(revenue / NULLIF(won_deals, 0), 2)                            AS "avgCheck",
            round(avg_min::numeric, 0)                                          AS "avgResponseMin",
            round(median_min::numeric, 0)                                       AS "medianResponseMin",
            round(100.0 * no_answer / NULLIF(leads, 0), 1)                      AS "noAnswerPct",
            round(100.0 * revenue / NULLIF(sum(revenue) OVER (), 0), 1)         AS "revenueSharePct",
            rank() OVER (ORDER BY revenue DESC)                                 AS "revenueRank"
     FROM joined
     ORDER BY revenue DESC, leads DESC`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}

export interface TeamMonthRow {
  month: string;
  userId: number;
  revenue: number;
  dealsWon: number;
}

export async function teamMonthly(pool: Pool, p: Period): Promise<TeamMonthRow[]> {
  const { rows } = await pool.query<TeamMonthRow>(
    `SELECT to_char(month, 'YYYY-MM') AS month, user_id AS "userId", sum(revenue) AS revenue, sum(deals_won) AS "dealsWon"
     FROM mv_manager_monthly
     WHERE vertical = $1
       AND month BETWEEN date_trunc('month', $2::date::timestamp)::date AND date_trunc('month', $3::date::timestamp)::date
       AND ($4::text IS NULL OR segment = $4)
     GROUP BY month, user_id
     HAVING sum(deals_won) > 0
     ORDER BY month, user_id`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}
