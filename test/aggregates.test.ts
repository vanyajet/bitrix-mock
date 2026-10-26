import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResponseCache } from '../src/api/cache.js';
import { resolvePeriod } from '../src/api/params.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Pool } from '../src/db/pool.js';
import { refreshMaterializedViews } from '../src/db/refresh.js';
import { funnel } from '../src/db/queries/funnel.js';
import { sourceBreakdown } from '../src/db/queries/marketing.js';
import { periodKpis } from '../src/db/queries/overview.js';
import { createTestPool, resetDatabase, silentLogger } from './helpers/db.js';
import { TEST_DATABASE_URL } from './helpers/config.js';

// Маленький набор с заранее посчитанными ответами (март 2026, стоматология):
//   google_ads: 4 лида, 3 выигранные сделки (10 000 + 20 000 + 30 000), расход 8 000
//   seo:        6 лидов, 2 выигранные (5 000 + 5 000) и 1 проигранная сделка, расход 3 000
// Шум, который не должен попасть в цифры: лид металлоконструкций и лид февраля
// (его сделка закрыта в марте - попадает в выручку по дате закрытия, но не в когорту).
const leads: Array<[number, string, string, string]> = [
  [1, 'dental', 'google_ads', '2026-03-02T10:00:00+03:00'],
  [2, 'dental', 'google_ads', '2026-03-05T10:00:00+03:00'],
  [3, 'dental', 'google_ads', '2026-03-10T10:00:00+03:00'],
  [4, 'dental', 'google_ads', '2026-03-31T23:30:00+03:00'], // последний день периода включительно
  [5, 'dental', 'seo', '2026-03-03T10:00:00+03:00'],
  [6, 'dental', 'seo', '2026-03-04T10:00:00+03:00'],
  [7, 'dental', 'seo', '2026-03-06T10:00:00+03:00'],
  [8, 'dental', 'seo', '2026-03-07T10:00:00+03:00'],
  [9, 'dental', 'seo', '2026-03-08T10:00:00+03:00'],
  [10, 'dental', 'seo', '2026-03-09T10:00:00+03:00'],
  [11, 'metal', 'google_ads', '2026-03-05T10:00:00+03:00'],
  [12, 'dental', 'seo', '2026-02-27T10:00:00+03:00'],
];
// [deal id, lead id, won, amount, closed_at]
const deals: Array<[number, number, boolean, number, string | null]> = [
  [101, 1, true, 10_000, '2026-03-12T12:00:00+03:00'],
  [102, 2, true, 20_000, '2026-03-15T12:00:00+03:00'],
  [103, 3, true, 30_000, '2026-04-02T12:00:00+03:00'], // закрыта в апреле: в когорте марта, но не в выручке марта
  [105, 5, true, 5_000, '2026-03-20T12:00:00+03:00'],
  [106, 6, true, 5_000, '2026-03-21T12:00:00+03:00'],
  [107, 7, false, 7_000, '2026-03-22T12:00:00+03:00'],
  [111, 11, true, 1_000_000, '2026-03-25T12:00:00+03:00'],
  [112, 12, true, 4_000, '2026-03-03T12:00:00+03:00'],
];

async function seed(pool: Pool): Promise<void> {
  for (const [id, vertical, source, created] of leads) {
    const deal = deals.find((d) => d[1] === id);
    const stage = deal ? 'QUALIFIED' : 'IN_PROGRESS';
    await pool.query(
      `INSERT INTO leads (bitrix_id, vertical, segment, source, stage, bitrix_status_id, assigned_user_id, amount, created_at, modified_at, is_won)
       VALUES ($1, $2, 'Терапия', $3, $4, 'X', 11, 0, $5, $5, $6)`,
      [id, vertical, source, stage, created, Boolean(deal)],
    );
  }
  for (const [id, leadId, won, amount, closed] of deals) {
    const lead = leads.find((l) => l[0] === leadId)!;
    await pool.query(
      `INSERT INTO deals (bitrix_id, lead_id, vertical, segment, source, stage, bitrix_stage_id, assigned_user_id, amount,
                          created_at, modified_at, closed_at, is_won)
       VALUES ($1, $2, $3, 'Терапия', $4, $5, 'X', 11, $6, $7, $7, $8, $9)`,
      [id, leadId, lead[1], lead[2], won ? 'WON' : 'LOST', amount, lead[3], closed, won],
    );
  }
  await pool.query(
    `INSERT INTO ad_spend (date, vertical, source, campaign, segment, impressions, clicks, spend) VALUES
       ('2026-03-01', 'dental', 'google_ads', 'g', 'Терапия', 10000, 200, 5000.00),
       ('2026-03-31', 'dental', 'google_ads', 'g', 'Терапия', 6000, 100, 3000.00),
       ('2026-03-15', 'dental', 'seo', 's', 'Терапия', 0, 0, 3000.00),
       ('2026-04-01', 'dental', 'seo', 's', 'Терапия', 0, 0, 99999.00),
       ('2026-03-15', 'metal', 'google_ads', 'm', 'ИЖС', 0, 0, 50000.00)`,
  );
  await refreshMaterializedViews(pool, silentLogger);
}

describe('SQL aggregates on a fixed dataset', () => {
  let pool: Pool;
  const period = resolvePeriod({ vertical: 'dental', from: '2026-03-01', to: '2026-03-31' }, 'Europe/Moscow');

  beforeAll(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
    await seed(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('computes conversion, CPL, CAC and ROMI for the period', async () => {
    const { current } = await periodKpis(pool, period);
    expect(current).toMatchObject({
      leads: 10,
      wonCohort: 5, // лиды марта, ставшие выигранными сделками (включая закрытую в апреле)
      conversionPct: 50,
      spend: 11_000,
      cpl: 1_100,
      cac: 2_200,
      revenueCohort: 70_000,
      romiPct: 536.4, // (70 000 - 11 000) / 11 000
      // по дате закрытия: 10 000 + 20 000 + 5 000 + 5 000 + 4 000 (лид февраля) - апрельская сделка не входит
      wonDeals: 5,
      revenue: 44_000,
      avgCheck: 8_800,
    });
  });

  it('computes per-source CPL and conversion', async () => {
    const { sources, total } = await sourceBreakdown(pool, period);
    const google = sources.find((s) => s.source === 'google_ads')!;
    const seo = sources.find((s) => s.source === 'seo')!;

    expect(google).toMatchObject({ leads: 4, won: 3, spend: 8_000, cpl: 2_000, leadToWonPct: 75, clicks: 300, ctrPct: 1.88 });
    expect(seo).toMatchObject({ leads: 6, deals: 3, won: 2, spend: 3_000, cpl: 500, leadToDealPct: 50, leadToWonPct: 33.3 });
    expect(total).toMatchObject({ leads: 10, won: 5, spend: 11_000, cpl: 1_100 });
    expect(google.sharePct! + seo.sharePct!).toBe(100);
  });

  it('builds the funnel with step conversions', async () => {
    const steps = await funnel(pool, period);
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s]));
    expect(byStage.NEW!.reached).toBe(10);
    expect(byStage.QUALIFIED!.reached).toBe(6); // лиды со сделкой
    expect(byStage.WON!.reached).toBe(5);
    expect(byStage.WON!.conversionFromStartPct).toBe(50);
    expect(byStage.QUALIFIED!.lostRejected).toBe(1); // проигранная сделка seo
  });

  it('serves the same numbers through the authenticated HTTP API', async () => {
    const env = loadEnv({ DATABASE_URL: TEST_DATABASE_URL, DASHBOARD_TOKEN: 'test-dashboard-token', BITRIX_MODE: 'mock' });
    const app = await buildApp({ env, pool, logger: silentLogger, cache: new ResponseCache(60_000) });
    try {
      const unauthorized = await app.inject({ url: '/api/overview' });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.headers['www-authenticate']).toContain('Basic');

      const res = await app.inject({
        url: '/api/overview?vertical=dental&from=2026-03-01&to=2026-03-31',
        headers: { authorization: `Basic ${Buffer.from('demo:test-dashboard-token').toString('base64')}` },
      });
      expect(res.statusCode).toBe(200);
      const kpis = Object.fromEntries((res.json().kpis as Array<{ key: string; value: number }>).map((k) => [k.key, k.value]));
      expect(kpis).toMatchObject({ leads: 10, conversion: 50, cpl: 1_100, romi: 536.4 });

      const invalid = await app.inject({ url: '/api/overview?vertical=retail', headers: { 'x-dashboard-token': 'test-dashboard-token' } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

      expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
