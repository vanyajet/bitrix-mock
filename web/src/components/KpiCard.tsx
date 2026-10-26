import { formatDelta, formatValue } from '../format';
import type { Kpi } from '../types';
import { Hint } from './ui';

function DeltaBadge({ kpi }: { kpi: Kpi }) {
  if (kpi.delta === null) return <span className="text-xs text-muted">нет данных для сравнения</span>;
  const good = kpi.delta === 0 ? null : (kpi.delta > 0) === (kpi.better === 'up');
  const arrow = kpi.delta > 0 ? '▲' : kpi.delta < 0 ? '▼' : '•';
  return (
    <span className={`text-xs font-medium ${good === null ? 'text-muted' : good ? 'text-good' : 'text-bad'}`}>
      {arrow} {formatDelta(kpi.delta, kpi.deltaUnit)}
      <span className="font-normal text-muted"> к пред. периоду</span>
    </span>
  );
}

export function KpiCard({ kpi, showDelta = true }: { kpi: Kpi; showDelta?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center text-xs text-ink-2">
        {kpi.label}
        {kpi.hint && <Hint text={kpi.hint} />}
      </div>
      <div className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight text-ink">{formatValue(kpi.value, kpi.format)}</div>
      {showDelta && (
        <div className="mt-1" title={kpi.previous !== null ? `Предыдущий период: ${formatValue(kpi.previous, kpi.format)}` : undefined}>
          <DeltaBadge kpi={kpi} />
        </div>
      )}
    </div>
  );
}
