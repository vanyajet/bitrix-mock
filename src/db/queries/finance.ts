import type { Period } from '../../api/params.js';
import type { Pool } from '../pool.js';

export interface FinanceKpis {
  revenue: number;
  wonDeals: number;
  avgCheck: number | null;
  plan: number;
  planCompletionPct: number | null;
  prevRevenue: number;
}

/** KPI периода. План за неполные месяцы берётся пропорционально числу дней периода в месяце. */
export async function financeKpis(pool: Pool, p: Period): Promise<FinanceKpis> {
  const { rows } = await pool.query<FinanceKpis>(
    `WITH fact AS (
       SELECT coalesce(sum(amount) FILTER (WHERE closed_at >= $2::date), 0) AS revenue,
              count(*) FILTER (WHERE closed_at >= $2::date)                 AS won_deals,
              coalesce(sum(amount) FILTER (WHERE closed_at < $2::date), 0)  AS prev_revenue
       FROM deals
       WHERE is_won AND vertical = $1 AND closed_at >= $5::date AND closed_at < $3::date + 1
         AND ($4::text IS NULL OR segment = $4)
     ),
     plan_months AS (
       SELECT revenue_plan, month, (month + interval '1 month')::date - 1 AS month_end
       FROM plans
       WHERE vertical = $1 AND ($4::text IS NULL OR segment = $4)
     ),
     plan AS (
       SELECT coalesce(sum(revenue_plan * (LEAST(month_end, $3::date) - GREATEST(month, $2::date) + 1)::numeric
                                         / (month_end - month + 1)), 0) AS plan
       FROM plan_months
       WHERE month <= $3::date AND month_end >= $2::date
     )
     SELECT f.revenue,
            f.won_deals                                          AS "wonDeals",
            round(f.revenue / NULLIF(f.won_deals, 0), 2)         AS "avgCheck",
            round(pl.plan, 2)                                    AS plan,
            round(100.0 * f.revenue / NULLIF(pl.plan, 0), 1)     AS "planCompletionPct",
            f.prev_revenue                                       AS "prevRevenue"
     FROM fact f CROSS JOIN plan pl`,
    [p.vertical, p.from, p.to, p.segment, p.prevFrom],
  );
  return rows[0]!;
}

export interface MonthSegmentRow {
  month: string;
  segment: string;
  revenue: number;
  deals: number;
}

/** Выручка по месяцам и сегментам (stacked) из materialized view. */
export async function revenueByMonthSegment(pool: Pool, p: Period): Promise<MonthSegmentRow[]> {
  const { rows } = await pool.query<MonthSegmentRow>(
    `SELECT to_char(month, 'YYYY-MM') AS month, segment, sum(revenue) AS revenue, sum(deals_won) AS deals
     FROM mv_manager_monthly
     WHERE vertical = $1
       AND month BETWEEN date_trunc('month', $2::date::timestamp)::date AND date_trunc('month', $3::date::timestamp)::date
       AND ($4::text IS NULL OR segment = $4)
       AND deals_won > 0
     GROUP BY month, segment
     ORDER BY month, segment`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}

export interface PlanFactRow {
  month: string;
  fact: number;
  plan: number;
  deals: number;
  avgCheck: number | null;
  completionPct: number | null;
  factCumulative: number;
  planCumulative: number;
}

export async function planFact(pool: Pool, p: Period): Promise<PlanFactRow[]> {
  const { rows } = await pool.query<PlanFactRow>(
    `WITH months AS (
       SELECT generate_series(date_trunc('month', $2::date::timestamp), date_trunc('month', $3::date::timestamp), interval '1 month')::date AS month
     ),
     fact AS (
       SELECT month, sum(revenue) AS revenue, sum(deals_won) AS deals
       FROM mv_manager_monthly
       WHERE vertical = $1 AND ($4::text IS NULL OR segment = $4)
       GROUP BY month
     ),
     plan AS (
       SELECT month, sum(revenue_plan) AS plan
       FROM plans
       WHERE vertical = $1 AND ($4::text IS NULL OR segment = $4)
       GROUP BY month
     )
     SELECT to_char(m.month, 'YYYY-MM')                                 AS month,
            coalesce(f.revenue, 0)                                      AS fact,
            coalesce(pl.plan, 0)                                        AS plan,
            coalesce(f.deals, 0)                                        AS deals,
            round(f.revenue / NULLIF(f.deals, 0), 2)                    AS "avgCheck",
            round(100.0 * f.revenue / NULLIF(pl.plan, 0), 1)            AS "completionPct",
            sum(coalesce(f.revenue, 0)) OVER (ORDER BY m.month)         AS "factCumulative",
            sum(coalesce(pl.plan, 0)) OVER (ORDER BY m.month)           AS "planCumulative"
     FROM months m
     LEFT JOIN fact f USING (month)
     LEFT JOIN plan pl USING (month)
     ORDER BY m.month`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}

export interface TopSegmentRow {
  segment: string;
  revenue: number;
  deals: number;
  avgCheck: number;
  sharePct: number | null;
  rank: number;
}

export async function topSegments(pool: Pool, p: Period): Promise<TopSegmentRow[]> {
  const { rows } = await pool.query<TopSegmentRow>(
    `SELECT coalesce(segment, '')                                                    AS segment,
            sum(amount)                                                              AS revenue,
            count(*)                                                                 AS deals,
            round(avg(amount), 2)                                                    AS "avgCheck",
            round(100.0 * sum(amount) / NULLIF(sum(sum(amount)) OVER (), 0), 1)     AS "sharePct",
            rank() OVER (ORDER BY sum(amount) DESC)                                  AS rank
     FROM deals
     WHERE is_won AND vertical = $1 AND closed_at >= $2::date AND closed_at < $3::date + 1
       AND ($4::text IS NULL OR segment = $4)
     GROUP BY 1
     ORDER BY revenue DESC`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}
