import { Card, CardHeader, Hint, QueryView } from '../components/ui';
import type { Filters } from '../filters';
import { formatHours, formatNumber, formatPct } from '../format';
import { useAnalytics } from '../queries';
import type { FunnelResponse, FunnelStep } from '../types';

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad'; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center text-xs text-ink-2">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className={`mt-1 text-xl font-semibold ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

function StepRow({ step, max }: { step: FunnelStep; max: number }) {
  // ширина полосы - только масштаб отображения: доля от числа лидов на входе
  const width = max > 0 ? Math.max(3, (step.count / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(110px,180px)_1fr_minmax(96px,150px)] items-center gap-3 sm:gap-5">
      <div>
        <div className="text-sm font-medium text-ink">{step.label}</div>
        <div className="text-xs text-muted">
          {step.avgHoursOnStage !== null ? <>в среднем {formatHours(step.avgHoursOnStage)} на стадии</> : step.stage === 'WON' ? 'финальная стадия' : '—'}
        </div>
      </div>
      <div className="flex justify-center" title={`${formatNumber(step.count)} лидов`}>
        <div className="h-9 rounded-md bg-accent" style={{ width: `${width}%` }} />
      </div>
      <div className="text-right">
        <div className="tabular text-lg font-semibold text-ink">{formatNumber(step.count)}</div>
        <div className="tabular text-xs text-muted">{formatPct(step.conversionFromStartPct)} от входа</div>
      </div>
    </div>
  );
}

function Transition({ next, from }: { next: FunnelStep; from: FunnelStep }) {
  const lost = from.lost.noAnswer + from.lost.rejected;
  return (
    <div className="grid grid-cols-[minmax(110px,180px)_1fr_minmax(96px,150px)] gap-3 py-1 sm:gap-5">
      <div />
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">↓ {formatPct(next.conversionFromPrevPct)} перешли дальше</span>
        {lost > 0 && (
          <span className="text-ink-2">
            потери:{' '}
            {from.lost.noAnswer > 0 && <span className="text-ink">{formatNumber(from.lost.noAnswer)} не дозвонились</span>}
            {from.lost.noAnswer > 0 && from.lost.rejected > 0 && ', '}
            {from.lost.rejected > 0 && <span className="text-ink">{formatNumber(from.lost.rejected)} отказ</span>}
          </span>
        )}
        {from.inProgress > 0 && <span className="text-muted">{formatNumber(from.inProgress)} ещё в работе</span>}
      </div>
      <div />
    </div>
  );
}

export function FunnelTab({ filters }: { filters: Filters }) {
  const query = useAnalytics<FunnelResponse>('funnel', filters);
  return (
    <QueryView query={query}>
      {(data) => {
        const max = data.steps[0]?.count ?? 0;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Лидов в когорте" value={formatNumber(data.totals.leads)} />
              <Stat label="Успешных сделок" value={formatNumber(data.totals.won)} tone="good" />
              <Stat label="Конверсия воронки" value={formatPct(data.totals.conversionPct)} hint={data.attribution.cohort} />
              <Stat label="Не дозвонились" value={formatNumber(data.totals.lostNoAnswer)} tone="bad" />
              <Stat label="Отказы" value={formatNumber(data.totals.lostRejected)} tone="bad" />
              <Stat label="Ещё в работе" value={formatNumber(data.totals.inProgress)} hint="Лиды и сделки, по которым пока нет финального исхода" />
            </div>
            <Card>
              <CardHeader
                title="Воронка продаж"
                subtitle="Лиды, созданные в периоде: до какой стадии дошли, где и почему потерялись. Время на стадии - по истории переходов (crm.stagehistory.list)."
              />
              <div className="px-5 pt-5 pb-6">
                {data.steps.map((step, i) => (
                  <div key={step.stage}>
                    {i > 0 && <Transition from={data.steps[i - 1]!} next={step} />}
                    <StepRow step={step} max={max} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      }}
    </QueryView>
  );
}
