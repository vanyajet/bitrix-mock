// Mock рекламного кабинета. В Bitrix24 расходов нет, их берут из Яндекс Директа / Google Ads;
// здесь - детерминированные дневные расходы, показы и клики по каналам и кампаниям (кампания = сегмент).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SOURCES, VERTICALS, type Source, type Vertical } from '../config/domain.js';
import { expectedLeads, MODELS, ORIGIN_DAY } from './model.js';
import { hashSeed, Rng } from './random.js';
import { DAY, dayNoFromIso, dayNoOf, dayStartMs, isoDateOf } from './time.js';

export interface AdSpendRow {
  date: string;
  vertical: Vertical;
  channel: Source;
  campaign: string;
  segment: string;
  impressions: number;
  clicks: number;
  spend: number;
  currency: 'RUB';
}

const CAMPAIGN_PREFIX: Partial<Record<Source, string>> = {
  yandex_direct: 'Директ',
  google_ads: 'Google Search',
  instagram: 'Instagram Ads',
  seo: 'SEO',
  cold_call: 'Колл-центр',
};

const MAX_RANGE_DAYS = 92;

/** Расходы за день. За сегодня - пропорционально прошедшей части дня, как в реальном кабинете. */
export function adSpendForDay(vertical: Vertical, dayNo: number, seed: number, now: number): AdSpendRow[] {
  const today = dayNoOf(now);
  if (dayNo < ORIGIN_DAY || dayNo > today) return [];
  const model = MODELS[vertical];
  const fraction = dayNo === today ? Math.min(1, (now - dayStartMs(dayNo)) / DAY) : 1;
  const leadsTotal = expectedLeads(model, dayNo);
  const rows: AdSpendRow[] = [];

  for (const channel of SOURCES) {
    const src = model.sources[channel];
    if (src.cpl === 0) continue;
    for (const segment of model.segments) {
      const rng = new Rng(hashSeed(seed, 'ads', vertical, channel, segment.code, dayNo));
      const expected = leadsTotal * src.share * segment.share;
      const spend = expected * src.cpl * rng.logNormal(1, 0.15) * fraction;
      const clicks =
        src.cpc > 0 ? spend / (src.cpc * rng.logNormal(1, 0.1)) : channel === 'seo' ? expected * 30 * rng.logNormal(1, 0.15) * fraction : 0;
      const impressions = src.ctr > 0 ? clicks / (src.ctr * rng.logNormal(1, 0.1)) : 0;
      rows.push({
        date: isoDateOf(dayNo),
        vertical,
        channel,
        campaign: `${CAMPAIGN_PREFIX[channel] ?? channel} | ${segment.label}`,
        segment: segment.label,
        impressions: Math.round(impressions),
        clicks: Math.round(clicks),
        spend: Math.round(spend * 100) / 100,
        currency: 'RUB',
      });
    }
  }
  return rows;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const SpendQuery = z.object({ from: isoDate, to: isoDate, vertical: z.enum(VERTICALS) });

export interface MockAdsOptions {
  token: string;
  seed: number;
  clock: () => number;
}

export async function mockAdsRoutes(app: FastifyInstance, opts: MockAdsOptions): Promise<void> {
  app.get('/spend', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing access token' } });
    }
    const parsed = SpendQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    }
    const { from, to, vertical } = parsed.data;
    const fromDay = dayNoFromIso(from);
    const toDay = dayNoFromIso(to);
    if (toDay < fromDay || toDay - fromDay + 1 > MAX_RANGE_DAYS) {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: `date range must be 1..${MAX_RANGE_DAYS} days` } });
    }
    const now = opts.clock();
    const data: AdSpendRow[] = [];
    for (let day = fromDay; day <= toDay; day++) data.push(...adSpendForDay(vertical, day, opts.seed, now));
    return { data, meta: { from, to, vertical, rows: data.length, currency: 'RUB' } };
  });
}
