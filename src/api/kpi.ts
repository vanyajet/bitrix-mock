export type KpiFormat = 'number' | 'money' | 'percent';

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  /** Относительное изменение, % (для процентных метрик - разница в п.п.). */
  delta: number | null;
  deltaUnit: 'pct' | 'pp';
  format: KpiFormat;
  /** Направление "хорошего" изменения: для CPL/CAC рост - это плохо. */
  better: 'up' | 'down';
  hint?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function delta(current: number | null, previous: number | null, unit: 'pct' | 'pp'): number | null {
  if (current === null || previous === null) return null;
  if (unit === 'pp') return round1(current - previous);
  if (previous === 0) return null;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

export function kpi(
  key: string,
  label: string,
  current: number | null,
  previous: number | null,
  format: KpiFormat,
  opts: { better?: 'up' | 'down'; hint?: string } = {},
): Kpi {
  const deltaUnit = format === 'percent' ? 'pp' : 'pct';
  return {
    key,
    label,
    value: current,
    previous,
    delta: delta(current, previous, deltaUnit),
    deltaUnit,
    format,
    better: opts.better ?? 'up',
    ...(opts.hint && { hint: opts.hint }),
  };
}
