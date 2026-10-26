-- Тяжёлые помесячные срезы по источникам и менеджерам. Обновляются REFRESH MATERIALIZED VIEW CONCURRENTLY
-- после каждого успешного синка (для CONCURRENTLY нужен уникальный индекс).
-- Месяцы считаются в часовом поясе сессии (APP_TZ задаётся при подключении).
-- Пустой сегмент/источник/менеджер храним как '' / 'unknown' / 0: NULL ломает уникальный ключ.

-- Маркетинг: лиды месяца (по дате создания) и что из них выросло, плюс расходы этого месяца.
CREATE MATERIALIZED VIEW mv_source_monthly AS
WITH lead_stats AS (
  SELECT date_trunc('month', l.created_at)::date                                AS month,
         l.vertical,
         coalesce(l.segment, '')                                                AS segment,
         coalesce(l.source, 'unknown')                                          AS source,
         count(DISTINCT l.bitrix_id)                                            AS leads,
         count(DISTINCT d.bitrix_id)                                            AS deals,
         count(DISTINCT d.bitrix_id) FILTER (WHERE d.is_won)                    AS won,
         coalesce(sum(d.amount) FILTER (WHERE d.is_won), 0)                     AS revenue
  FROM leads l
  LEFT JOIN deals d ON d.lead_id = l.bitrix_id
  GROUP BY 1, 2, 3, 4
),
spend_stats AS (
  SELECT date_trunc('month', a.date)::date AS month,
         a.vertical,
         coalesce(a.segment, '')           AS segment,
         a.source,
         sum(a.spend)                      AS spend,
         sum(a.clicks)                     AS clicks,
         sum(a.impressions)                AS impressions
  FROM ad_spend a
  GROUP BY 1, 2, 3, 4
)
SELECT coalesce(l.month, s.month)       AS month,
       coalesce(l.vertical, s.vertical) AS vertical,
       coalesce(l.segment, s.segment)   AS segment,
       coalesce(l.source, s.source)     AS source,
       coalesce(l.leads, 0)             AS leads,
       coalesce(l.deals, 0)             AS deals,
       coalesce(l.won, 0)               AS won,
       coalesce(l.revenue, 0)           AS revenue,
       coalesce(s.spend, 0)             AS spend,
       coalesce(s.clicks, 0)            AS clicks,
       coalesce(s.impressions, 0)       AS impressions
FROM lead_stats l
FULL JOIN spend_stats s
  ON s.month = l.month AND s.vertical = l.vertical AND s.segment = l.segment AND s.source = l.source;

CREATE UNIQUE INDEX mv_source_monthly_key ON mv_source_monthly (month, vertical, segment, source);

-- Команда и финансы: лиды менеджера по месяцу создания, выигранные сделки и выручка по месяцу закрытия.
CREATE MATERIALIZED VIEW mv_manager_monthly AS
WITH lead_stats AS (
  SELECT date_trunc('month', l.created_at)::date             AS month,
         l.vertical,
         coalesce(l.segment, '')                             AS segment,
         coalesce(l.assigned_user_id, 0)                     AS user_id,
         count(DISTINCT l.bitrix_id)                         AS leads,
         count(DISTINCT d.bitrix_id) FILTER (WHERE d.is_won) AS won_cohort
  FROM leads l
  LEFT JOIN deals d ON d.lead_id = l.bitrix_id
  GROUP BY 1, 2, 3, 4
),
won_stats AS (
  SELECT date_trunc('month', d.closed_at)::date AS month,
         d.vertical,
         coalesce(d.segment, '')                AS segment,
         coalesce(d.assigned_user_id, 0)        AS user_id,
         count(*)                               AS deals_won,
         sum(d.amount)                          AS revenue
  FROM deals d
  WHERE d.is_won AND d.closed_at IS NOT NULL
  GROUP BY 1, 2, 3, 4
)
SELECT coalesce(l.month, w.month)       AS month,
       coalesce(l.vertical, w.vertical) AS vertical,
       coalesce(l.segment, w.segment)   AS segment,
       coalesce(l.user_id, w.user_id)   AS user_id,
       coalesce(l.leads, 0)             AS leads,
       coalesce(l.won_cohort, 0)        AS won_cohort,
       coalesce(w.deals_won, 0)         AS deals_won,
       coalesce(w.revenue, 0)           AS revenue
FROM lead_stats l
FULL JOIN won_stats w
  ON w.month = l.month AND w.vertical = l.vertical AND w.segment = l.segment AND w.user_id = l.user_id;

CREATE UNIQUE INDEX mv_manager_monthly_key ON mv_manager_monthly (month, vertical, segment, user_id);
