import type { Period } from '../../api/params.js';
import type { Pool } from '../pool.js';

export interface SourceRow {
  source: string;
  name: string;
  leads: number;
  deals: number;
  won: number;
  revenue: number;
  spend: number;
  clicks: number;
  impressions: number;
  cpl: number | null;
  cpc: number | null;
  ctrPct: number | null;
  leadToDealPct: number | null;
  leadToWonPct: number | null;
  cac: number | null;
  romiPct: number | null;
  sharePct: number | null;
}

/** Срез по источникам за период + строка итогов (source = 'total'). Выручка - с лидов периода. */
export async function sourceBreakdown(pool: Pool, p: Period): Promise<{ sources: SourceRow[]; total: SourceRow }> {
  const { rows } = await pool.query<SourceRow>(
    `WITH l AS (
       SELECT coalesce(l.source, 'unknown')                       AS source,
              count(DISTINCT l.bitrix_id)                         AS leads,
              count(DISTINCT d.bitrix_id)                         AS deals,
              count(DISTINCT d.bitrix_id) FILTER (WHERE d.is_won) AS won,
              coalesce(sum(d.amount) FILTER (WHERE d.is_won), 0)  AS revenue
       FROM leads l
       LEFT JOIN deals d ON d.lead_id = l.bitrix_id
       WHERE l.vertical = $1 AND l.created_at >= $2::date AND l.created_at < $3::date + 1 AND ($4::text IS NULL OR l.segment = $4)
       GROUP BY 1
     ),
     s AS (
       SELECT source, sum(spend) AS spend, sum(clicks) AS clicks, sum(impressions) AS impressions
       FROM ad_spend
       WHERE vertical = $1 AND date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR segment = $4)
       GROUP BY 1
     ),
     j AS (
       SELECT coalesce(l.source, s.source) AS source,
              coalesce(l.leads, 0) AS leads, coalesce(l.deals, 0) AS deals, coalesce(l.won, 0) AS won,
              coalesce(l.revenue, 0) AS revenue, coalesce(s.spend, 0) AS spend,
              coalesce(s.clicks, 0) AS clicks, coalesce(s.impressions, 0) AS impressions
       FROM l FULL JOIN s ON s.source = l.source
     ),
     combined AS (
       SELECT source, leads, deals, won, revenue, spend, clicks, impressions, 0 AS is_total FROM j
       UNION ALL
       SELECT 'total', sum(leads), sum(deals), sum(won), sum(revenue), sum(spend), sum(clicks), sum(impressions), 1 FROM j
     )
     SELECT r.source,
            coalesce(src.name, CASE WHEN r.source = 'total' THEN 'Итого' ELSE r.source END) AS name,
            coalesce(r.leads, 0) AS leads, coalesce(r.deals, 0) AS deals, coalesce(r.won, 0) AS won,
            coalesce(r.revenue, 0) AS revenue, coalesce(r.spend, 0) AS spend,
            coalesce(r.clicks, 0) AS clicks, coalesce(r.impressions, 0) AS impressions,
            round(r.spend / NULLIF(r.leads, 0), 2)                         AS cpl,
            round(r.spend / NULLIF(r.clicks, 0), 2)                        AS cpc,
            round(100.0 * r.clicks / NULLIF(r.impressions, 0), 2)          AS "ctrPct",
            round(100.0 * r.deals / NULLIF(r.leads, 0), 1)                 AS "leadToDealPct",
            round(100.0 * r.won / NULLIF(r.leads, 0), 1)                   AS "leadToWonPct",
            round(r.spend / NULLIF(r.won, 0), 2)                           AS cac,
            round(100.0 * (r.revenue - r.spend) / NULLIF(r.spend, 0), 1)   AS "romiPct",
            round(100.0 * r.leads / NULLIF(sum(r.leads) FILTER (WHERE r.is_total = 0) OVER (), 0), 1) AS "sharePct"
     FROM combined r
     LEFT JOIN sources src ON src.code = r.source
     ORDER BY r.is_total, r.leads DESC, r.source`,
    [p.vertical, p.from, p.to, p.segment],
  );
  const total = rows.find((r) => r.source === 'total')!;
  return { sources: rows.filter((r) => r.source !== 'total'), total };
}

export interface SourceMonthRow {
  month: string;
  /** null - итог месяца по всем источникам (GROUPING SETS) */
  source: string | null;
  leads: number;
  won: number;
  revenue: number;
  spend: number;
  cpl: number | null;
}

/** Помесячная динамика по источникам из materialized view (полные месяцы, пересекающие период). */
export async function sourceMonthly(pool: Pool, p: Period): Promise<SourceMonthRow[]> {
  const { rows } = await pool.query<SourceMonthRow>(
    `SELECT to_char(month, 'YYYY-MM') AS month, source,
            sum(leads) AS leads, sum(won) AS won, sum(revenue) AS revenue, sum(spend) AS spend,
            round(sum(spend) / NULLIF(sum(leads), 0), 2) AS cpl
     FROM mv_source_monthly
     WHERE vertical = $1
       AND month BETWEEN date_trunc('month', $2::date::timestamp)::date AND date_trunc('month', $3::date::timestamp)::date
       AND ($4::text IS NULL OR segment = $4)
     GROUP BY GROUPING SETS ((month, source), (month))
     ORDER BY month, source NULLS FIRST`,
    [p.vertical, p.from, p.to, p.segment],
  );
  return rows;
}
