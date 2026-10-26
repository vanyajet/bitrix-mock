import type { Period } from '../../api/params.js';
import type { Pool } from '../pool.js';

// Атрибуция (зафиксирована в README):
// - конверсия, CPL, CAC, ROMI - по когорте лидов, созданных в периоде (что выросло из этих лидов);
// - выручка, выигранные сделки, средний чек - по дате закрытия сделки в периоде.

export interface PeriodKpis {
  leads: number;
  deals: number;
  wonCohort: number;
  revenueCohort: number;
  wonDeals: number;
  revenue: number;
  spend: number;
  conversionPct: number | null;
  avgCheck: number | null;
  cpl: number | null;
  cac: number | null;
  romiPct: number | null;
}

export async function periodKpis(pool: Pool, p: Period): Promise<{ current: PeriodKpis; previous: PeriodKpis }> {
  const { rows } = await pool.query<PeriodKpis & { period: string }>(
    `WITH periods(period, d_from, d_to) AS (
       VALUES ('current', $2::date, $3::date), ('previous', $5::date, $6::date)
     ),
     cohort AS (
       SELECT p.period,
              count(DISTINCT l.bitrix_id)                         AS leads,
              count(DISTINCT d.bitrix_id)                         AS deals,
              count(DISTINCT d.bitrix_id) FILTER (WHERE d.is_won) AS won_cohort,
              coalesce(sum(d.amount) FILTER (WHERE d.is_won), 0)  AS revenue_cohort
       FROM periods p
       JOIN leads l ON l.vertical = $1 AND l.created_at >= p.d_from AND l.created_at < p.d_to + 1
                   AND ($4::text IS NULL OR l.segment = $4)
       LEFT JOIN deals d ON d.lead_id = l.bitrix_id
       GROUP BY p.period
     ),
     closed AS (
       SELECT p.period, count(*) AS won_deals, sum(d.amount) AS revenue
       FROM periods p
       JOIN deals d ON d.is_won AND d.vertical = $1 AND d.closed_at >= p.d_from AND d.closed_at < p.d_to + 1
                   AND ($4::text IS NULL OR d.segment = $4)
       GROUP BY p.period
     ),
     spend AS (
       SELECT p.period, sum(a.spend) AS spend
       FROM periods p
       JOIN ad_spend a ON a.vertical = $1 AND a.date BETWEEN p.d_from AND p.d_to AND ($4::text IS NULL OR a.segment = $4)
       GROUP BY p.period
     )
     SELECT p.period,
            coalesce(c.leads, 0)                                                      AS leads,
            coalesce(c.deals, 0)                                                      AS deals,
            coalesce(c.won_cohort, 0)                                                 AS "wonCohort",
            coalesce(c.revenue_cohort, 0)                                             AS "revenueCohort",
            coalesce(x.won_deals, 0)                                                  AS "wonDeals",
            coalesce(x.revenue, 0)                                                    AS revenue,
            coalesce(s.spend, 0)                                                      AS spend,
            round(100.0 * c.won_cohort / NULLIF(c.leads, 0), 2)                       AS "conversionPct",
            round(x.revenue / NULLIF(x.won_deals, 0), 2)                              AS "avgCheck",
            round(s.spend / NULLIF(c.leads, 0), 2)                                    AS cpl,
            round(s.spend / NULLIF(c.won_cohort, 0), 2)                               AS cac,
            round(100.0 * (coalesce(c.revenue_cohort, 0) - s.spend) / NULLIF(s.spend, 0), 1) AS "romiPct"
     FROM periods p
     LEFT JOIN cohort c USING (period)
     LEFT JOIN closed x USING (period)
     LEFT JOIN spend s USING (period)`,
    [p.vertical, p.from, p.to, p.segment, p.prevFrom, p.prevTo],
  );
  const pick = (name: string) => {
    const { period: _period, ...kpis } = rows.find((r) => r.period === name)!;
    return kpis;
  };
  return { current: pick('current'), previous: pick('previous') };
}

export interface WeeklyPoint {
  week: string;
  leads: number;
  wonDeals: number;
  revenue: number;
}

/** Недельный ряд: лиды по дате создания, выручка по дате закрытия. Пустые недели заполняются нулями. */
export async function weeklySeries(pool: Pool, p: Period): Promise<WeeklyPoint[]> {
  const { rows } = await pool.query<WeeklyPoint>(
    `WITH weeks AS (
       SELECT generate_series(date_trunc('week', $2::date::timestamp), date_trunc('week', $3::date::timestamp), interval '1 week')::date AS week
     ),
     l AS (
       SELECT date_trunc('week', created_at)::date AS week, count(*) AS leads
       FROM leads
       WHERE vertical = $1 AND created_at >= $2::date AND created_at < $3::date + 1 AND ($4::text IS NULL OR segment = $4)
       GROUP BY 1
     ),
     r AS (
       SELECT date_trunc('week', closed_at)::date AS week, count(*) AS won_deals, sum(amount) AS revenue
       FROM deals
       WHERE is_won AND vertical = $1 AND closed_at >= $2::date AND closed_at < $3::date + 1 AND ($4::text IS NULL OR segment = $4)
       GROUP BY 1
     )
     SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
            coalesce(l.leads, 0)          AS leads,
            coalesce(r.won_deals, 0)      AS "wonDeals",
            coalesce(r.revenue, 0)        AS revenue
     FROM weeks w
     LEFT JOIN l USING (week)
     LEFT JOIN r USING (week)
     ORDER BY w.week`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}
