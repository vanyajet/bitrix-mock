import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_MARGIN, Legend, TooltipBox, valueAxisProps, type TooltipProps } from '../components/charts';
import { DataTable, MiniBar, type Column } from '../components/DataTable';
import { KpiCard } from '../components/KpiCard';
import { Card, CardHeader, EmptyState, QueryView } from '../components/ui';
import type { Filters } from '../filters';
import { formatMoney, formatMonth, formatNumber, formatPct } from '../format';
import { useAnalytics } from '../queries';
import { colorMap, stableKeys, useChartTheme } from '../theme';
import type { FinanceResponse } from '../types';

type TopRow = FinanceResponse['topSegments'][number];
type PlanRow = FinanceResponse['planFact'][number];

function RevenueBySegment({ data }: { data: FinanceResponse['revenueBySegment'] }) {
  const theme = useChartTheme();
  const keys = stableKeys(data.segments);
  const colors = colorMap(keys, theme);
  return (
    <Card>
      <CardHeader title="Выручка по месяцам и сегментам" subtitle="По дате закрытия выигранных сделок"
        right={<Legend items={keys.map((k) => ({ key: k, label: k, color: colors[k]! }))} />} />
      <div className="px-3 pt-3 pb-4">
        {data.rows.length === 0 ? <EmptyState text="Нет выигранных сделок за период" /> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.rows} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps(theme)} />
              <YAxis {...valueAxisProps(theme)} />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.5 }}
                content={({ active, payload, label }: TooltipProps) =>
                  active && payload?.length ? (
                    <TooltipBox title={formatMonth(String(label))}
                      rows={[...payload].reverse().map((p) => ({ name: String(p.dataKey), value: formatMoney(Number(p.value)), color: p.color }))} />
                  ) : null
                }
              />
              {keys.map((k, i) => (
                <Bar isAnimationActive={false} key={k} dataKey={k} stackId="rev" fill={colors[k]} stroke={theme.surface} strokeWidth={1} maxBarSize={32}
                  radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function PlanFact({ rows }: { rows: PlanRow[] }) {
  const theme = useChartTheme();
  const factColor = theme.series[0]!;
  const planColor = theme.ink2;
  const hasPlan = rows.some((r) => r.plan > 0);
  return (
    <Card>
      <CardHeader
        title="План / факт"
        subtitle={hasPlan ? 'Текущий месяц - факт на сегодня против плана на весь месяц' : 'План не задан: заполните таблицу plans (см. README)'}
        right={
          <Legend
            items={[
              { key: 'fact', label: 'Факт', color: factColor },
              ...(hasPlan ? [{ key: 'plan', label: 'План', color: planColor, dashed: true }] : []),
            ]}
          />
        }
      />
      <div className="px-3 pt-3 pb-4">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps(theme)} />
            <YAxis {...valueAxisProps(theme)} />
            <Tooltip
              cursor={{ fill: theme.grid, opacity: 0.5 }}
              content={({ active, payload, label }: TooltipProps) => {
                const r = payload?.[0]?.payload as PlanRow | undefined;
                if (!active || !r) return null;
                return (
                  <TooltipBox title={formatMonth(String(label))}
                    rows={[
                      { name: 'Факт', value: formatMoney(r.fact), color: factColor },
                      { name: 'План', value: formatMoney(r.plan), color: planColor },
                      { name: 'Выполнение', value: formatPct(r.completionPct) },
                      { name: 'Сделок', value: formatNumber(r.deals) },
                      { name: 'Средний чек', value: formatMoney(r.avgCheck, { compact: true }) },
                    ]}
                    footer={`С начала периода: ${formatMoney(r.factCumulative)} из ${formatMoney(r.planCumulative)}`} />
                );
              }}
            />
            <Bar isAnimationActive={false} dataKey="fact" fill={factColor} radius={[4, 4, 0, 0]} maxBarSize={32} />
            {hasPlan && <Line isAnimationActive={false} dataKey="plan" stroke={planColor} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: planColor, strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: theme.surface, strokeWidth: 2 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const topColumns = (maxShare: number): Column<TopRow>[] => [
  { key: 'rank', header: '#', render: (r) => <span className="text-muted">{r.rank}</span>, sortValue: (r) => -r.rank },
  { key: 'segment', header: 'Сегмент', render: (r) => <span className="font-medium">{r.segment}</span>, sortValue: (r) => r.segment },
  { key: 'revenue', header: 'Выручка', align: 'right', render: (r) => formatMoney(r.revenue), sortValue: (r) => r.revenue },
  { key: 'share', header: 'Доля', align: 'right', render: (r) => <MiniBar value={r.sharePct} max={maxShare} label={formatPct(r.sharePct)} />, sortValue: (r) => r.sharePct },
  { key: 'deals', header: 'Сделок', align: 'right', render: (r) => formatNumber(r.deals), sortValue: (r) => r.deals },
  { key: 'avg', header: 'Средний чек', align: 'right', render: (r) => formatMoney(r.avgCheck, { compact: true }), sortValue: (r) => r.avgCheck },
];

export function FinanceTab({ filters }: { filters: Filters }) {
  const query = useAnalytics<FinanceResponse>('finance', filters);
  return (
    <QueryView query={query}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {data.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} showDelta={k.key === 'revenue'} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueBySegment data={data.revenueBySegment} />
            <PlanFact rows={data.planFact} />
          </div>
          <Card>
            <CardHeader title="Топ сегментов" subtitle="Выигранные сделки, закрытые в периоде" />
            <div className="mt-2">
              <DataTable caption="Топ сегментов" rows={data.topSegments} rowKey={(r) => r.segment}
                columns={topColumns(Math.max(0, ...data.topSegments.map((t) => t.sharePct ?? 0)))} />
            </div>
          </Card>
        </div>
      )}
    </QueryView>
  );
}
