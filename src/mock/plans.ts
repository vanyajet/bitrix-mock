// План выручки - бизнес-настройка, в Bitrix24 его нет. В демо он рассчитывается из той же модели,
// что и данные (ожидаемая выручка +10% "амбициозности"), и сидируется идемпотентно.

import { VERTICALS } from '../config/domain.js';
import type { Pool } from '../db/pool.js';
import { expectedLeads, managerWeights, MODELS, ORIGIN_DAY, winRate, type SegmentDef, type VerticalModel } from './model.js';
import { dayNoFromIso, dayStartMs, localParts } from './time.js';

const PLAN_UPLIFT = 1.1;
// E[logNormal(1, 0.35)] - разброс чека лида относительно среднего
const CHECK_SPREAD = Math.exp(0.35 ** 2 / 2);

/** Ожидаемая выручка с одного лида сегмента (вероятность выигрыша x средний чек). */
function revenuePerLead(model: VerticalModel, segment: SegmentDef): number {
  const managers = managerWeights(model, segment);
  const managerTotal = managers.reduce((s, [, w]) => s + w, 0);
  let value = 0;
  for (const [manager, mw] of managers) {
    for (const source of Object.values(model.sources)) {
      value += (mw / managerTotal) * source.share * winRate(model, manager, source, segment) * segment.avgCheck * manager.checkFactor;
    }
  }
  return value * CHECK_SPREAD;
}

export interface PlanRow {
  vertical: string;
  segment: string;
  month: string;
  revenuePlan: number;
}

export function buildPlans(now: number, monthsAhead = 2): PlanRow[] {
  const end = localParts(now);
  const lastMonthIndex = end.year * 12 + end.month - 1 + monthsAhead;
  const rows: PlanRow[] = [];
  for (const vertical of VERTICALS) {
    const model = MODELS[vertical];
    for (const segment of model.segments) {
      const perLead = revenuePerLead(model, segment);
      const start = localParts(dayStartMs(ORIGIN_DAY));
      for (let mi = start.year * 12 + start.month - 1; mi <= lastMonthIndex; mi++) {
        const year = Math.floor(mi / 12);
        const month = (mi % 12) + 1;
        const first = dayNoFromIso(`${year}-${String(month).padStart(2, '0')}-01`);
        const days = localParts(dayStartMs(first)).daysInMonth;
        let leads = 0;
        for (let d = first; d < first + days; d++) leads += expectedLeads(model, d);
        const step = vertical === 'dental' ? 10_000 : 100_000;
        rows.push({
          vertical,
          segment: segment.label,
          month: `${year}-${String(month).padStart(2, '0')}-01`,
          revenuePlan: Math.round((leads * segment.share * perLead * PLAN_UPLIFT) / step) * step,
        });
      }
    }
  }
  return rows;
}

/** Идемпотентно: существующие планы не перезаписываются (их могли поправить руками). */
export async function seedPlans(pool: Pool, now = Date.now()): Promise<number> {
  const rows = buildPlans(now);
  const result = await pool.query(
    `INSERT INTO plans (vertical, segment, month, revenue_plan)
     SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::numeric[])
     ON CONFLICT (vertical, segment, month) DO NOTHING`,
    [rows.map((r) => r.vertical), rows.map((r) => r.segment), rows.map((r) => r.month), rows.map((r) => r.revenuePlan)],
  );
  return result.rowCount ?? 0;
}

