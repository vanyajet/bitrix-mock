// Aggregation API. Все числа считаются в SQL; здесь только валидация, кэш и раскладка по структуре ответа.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { STAGE_LABELS, VERTICAL_LABELS, VERTICALS, type Stage } from '../config/domain.js';
import type { AppContext } from '../context.js';
import { financeKpis, planFact, revenueByMonthSegment, topSegments } from '../db/queries/finance.js';
import { funnel } from '../db/queries/funnel.js';
import { sourceBreakdown, sourceMonthly } from '../db/queries/marketing.js';
import { segmentOptions } from '../db/queries/meta.js';
import { periodKpis, weeklySeries } from '../db/queries/overview.js';
import { teamMonthly, teamStats } from '../db/queries/team.js';
import { kpi } from './kpi.js';
import { cacheKey, resolvePeriod, type Period } from './params.js';

const ATTRIBUTION = {
  cohort: 'Конверсия, CPL, CAC и ROMI считаются по лидам, созданным в периоде (что из них выросло к текущему моменту).',
  closed: 'Выручка, выигранные сделки и средний чек - по дате закрытия сделки в периоде.',
};

/** Пивот "длинных" строк в "широкие" для stacked-графиков: только перекладывание, без вычислений. */
function pivot<T extends { month: string }>(rows: T[], series: (r: T) => string, value: (r: T) => number) {
  const months = new Map<string, Record<string, number | string>>();
  const keys = new Set<string>();
  for (const r of rows) {
    const key = series(r);
    keys.add(key);
    const row = months.get(r.month) ?? { month: r.month };
    row[key] = value(r);
    months.set(r.month, row);
  }
  return { keys: [...keys], rows: [...months.values()] };
}

export async function analyticsRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { pool, cache, env } = ctx;

  /** Общая обвязка: zod-валидация периода, кэш на 60 с, заголовок X-Cache. */
  const cachedRoute = (route: string, build: (p: Period) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const period = resolvePeriod(req.query, env.APP_TZ);
      const { value, hit } = await cache.getOrCompute(cacheKey(route, period), () => build(period));
      reply.header('X-Cache', hit ? 'HIT' : 'MISS');
      return { period, ...(value as object) };
    };

  app.get(
    '/overview',
    cachedRoute('overview', async (p) => {
      const [{ current: c, previous: v }, weekly] = await Promise.all([periodKpis(pool, p), weeklySeries(pool, p)]);
      return {
        kpis: [
          kpi('leads', 'Лиды', c.leads, v.leads, 'number'),
          kpi('wonDeals', 'Сделок выиграно', c.wonDeals, v.wonDeals, 'number', { hint: ATTRIBUTION.closed }),
          kpi('conversion', 'Конверсия лид → продажа', c.conversionPct, v.conversionPct, 'percent', { hint: ATTRIBUTION.cohort }),
          kpi('revenue', 'Выручка', c.revenue, v.revenue, 'money', { hint: ATTRIBUTION.closed }),
          kpi('avgCheck', 'Средний чек', c.avgCheck, v.avgCheck, 'money'),
          kpi('spend', 'Расходы на рекламу', c.spend, v.spend, 'money', { better: 'down' }),
          kpi('cpl', 'CPL', c.cpl, v.cpl, 'money', { better: 'down', hint: 'Стоимость лида: расходы / лиды' }),
          kpi('cac', 'CAC', c.cac, v.cac, 'money', { better: 'down', hint: 'Стоимость клиента: расходы / выигранные сделки с лидов периода' }),
          kpi('revenueCohort', 'Выручка с лидов периода', c.revenueCohort, v.revenueCohort, 'money', {
            hint: 'Выигранные сделки по лидам, созданным в периоде (база для ROMI)',
          }),
          kpi('romi', 'ROMI', c.romiPct, v.romiPct, 'percent', { hint: '(выручка с лидов периода − расходы) / расходы' }),
        ],
        weekly,
        attribution: ATTRIBUTION,
      };
    }),
  );

  app.get(
    '/marketing',
    cachedRoute('marketing', async (p) => {
      const [{ sources, total }, monthly] = await Promise.all([sourceBreakdown(pool, p), sourceMonthly(pool, p)]);
      const names = Object.fromEntries(sources.map((s) => [s.source, s.name]));
      const bySource = monthly.filter((r) => r.source !== null);
      const monthTotals = monthly.filter((r) => r.source === null);
      const leadsPivot = pivot(bySource, (r) => r.source!, (r) => r.leads);
      return {
        sources,
        total,
        monthly: {
          sources: leadsPivot.keys.map((code) => ({ code, name: names[code] ?? code })),
          leadsBySource: leadsPivot.rows,
          totals: monthTotals.map(({ month, leads, won, revenue, spend, cpl }) => ({ month, leads, won, revenue, spend, cpl })),
        },
        attribution: ATTRIBUTION,
      };
    }),
  );

  app.get(
    '/funnel',
    cachedRoute('funnel', async (p) => {
      const rows = await funnel(pool, p);
      const first = rows[0];
      const won = rows.find((r) => r.stage === 'WON');
      return {
        steps: rows.map((r) => ({
          stage: r.stage,
          label: STAGE_LABELS[r.stage as Stage] ?? r.stage,
          count: r.reached,
          conversionFromPrevPct: r.conversionFromPrevPct,
          conversionFromStartPct: r.conversionFromStartPct,
          lost: { noAnswer: r.lostNoAnswer, rejected: r.lostRejected },
          inProgress: r.inProgress,
          avgHoursOnStage: r.avgHoursOnStage,
        })),
        totals: {
          leads: first?.reached ?? 0,
          won: won?.reached ?? 0,
          conversionPct: won?.conversionFromStartPct ?? null,
          lostNoAnswer: first?.totalLostNoAnswer ?? 0,
          lostRejected: first?.totalLostRejected ?? 0,
          inProgress: first?.totalInProgress ?? 0,
        },
        attribution: ATTRIBUTION,
      };
    }),
  );

  app.get(
    '/finance',
    cachedRoute('finance', async (p) => {
      const [k, byMonth, pf, top] = await Promise.all([
        financeKpis(pool, p),
        revenueByMonthSegment(pool, p),
        planFact(pool, p),
        topSegments(pool, p),
      ]);
      const stacked = pivot(byMonth, (r) => r.segment || 'Без сегмента', (r) => r.revenue);
      return {
        kpis: [
          kpi('revenue', 'Выручка', k.revenue, k.prevRevenue, 'money', { hint: ATTRIBUTION.closed }),
          kpi('wonDeals', 'Сделок выиграно', k.wonDeals, null, 'number'),
          kpi('avgCheck', 'Средний чек', k.avgCheck, null, 'money'),
          kpi('plan', 'План за период', k.plan, null, 'money', { hint: 'План неполных месяцев берётся пропорционально дням' }),
          kpi('planCompletion', 'Выполнение плана', k.planCompletionPct, null, 'percent'),
        ],
        revenueBySegment: { segments: stacked.keys, rows: stacked.rows },
        planFact: pf,
        topSegments: top.map((t) => ({ ...t, segment: t.segment || 'Без сегмента' })),
        attribution: ATTRIBUTION,
      };
    }),
  );

  app.get(
    '/team',
    cachedRoute('team', async (p) => {
      const [members, monthly] = await Promise.all([teamStats(pool, p), teamMonthly(pool, p)]);
      const names = new Map(members.map((m) => [String(m.id), m.name]));
      const stacked = pivot(monthly, (r) => String(r.userId), (r) => r.revenue);
      return {
        members,
        monthlyRevenue: {
          users: stacked.keys.map((id) => ({ id, name: names.get(id) ?? `#${id}` })),
          rows: stacked.rows,
        },
        attribution: ATTRIBUTION,
      };
    }),
  );

  app.get('/meta', async () => {
    const { value } = await cache.getOrCompute('meta', async () => {
      const segments = await segmentOptions(pool);
      return {
        mode: env.BITRIX_MODE,
        timezone: env.APP_TZ,
        syncIntervalMin: env.SYNC_INTERVAL_MIN,
        verticals: VERTICALS.map((code) => ({
          code,
          label: VERTICAL_LABELS[code],
          segments: segments.filter((s) => s.vertical === code).map((s) => s.segment),
        })),
      };
    });
    return value;
  });
}
