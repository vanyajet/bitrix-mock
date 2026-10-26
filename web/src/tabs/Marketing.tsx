import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_MARGIN, Legend, TooltipBox, valueAxisProps, type TooltipProps } from '../components/charts';
import { DataTable, type Column } from '../components/DataTable';
import { Card, CardHeader, EmptyState, QueryView, Segmented } from '../components/ui';
import type { Filters } from '../filters';
import { formatMoney, formatMonth, formatNumber, formatPct } from '../format';
import { useAnalytics } from '../queries';
import { colorMap, SOURCE_ORDER, stableKeys, useChartTheme } from '../theme';
import type { MarketingResponse, SourceRow } from '../types';

const METRICS = [
  { id: 'leads', label: 'Лиды', get: (s: SourceRow) => s.leads, fmt: formatNumber },
  { id: 'cpl', label: 'CPL', get: (s: SourceRow) => s.cpl, fmt: (v: number | null) => formatMoney(v, { compact: false }) },
  { id: 'conv', label: 'Конверсия', get: (s: SourceRow) => s.leadToWonPct, fmt: (v: number | null) => formatPct(v) },
  { id: 'romi', label: 'ROMI', get: (s: SourceRow) => s.romiPct, fmt: (v: number | null) => formatPct(v, 0) },
] as const;
type MetricId = (typeof METRICS)[number]['id'];

const columns: Column<SourceRow>[] = [
  { key: 'name', header: 'Источник', render: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name },
  { key: 'leads', header: 'Лиды', align: 'right', render: (r) => formatNumber(r.leads), sortValue: (r) => r.leads },
  { key: 'share', header: 'Доля', align: 'right', render: (r) => formatPct(r.sharePct), sortValue: (r) => r.sharePct },
  { key: 'spend', header: 'Расход', align: 'right', render: (r) => formatMoney(r.spend, { compact: false }), sortValue: (r) => r.spend },
  { key: 'cpl', header: 'CPL', align: 'right', render: (r) => formatMoney(r.cpl, { compact: false }), sortValue: (r) => r.cpl, hint: 'Расход / лиды' },
  { key: 'ctr', header: 'CTR', align: 'right', render: (r) => formatPct(r.ctrPct, 2), sortValue: (r) => r.ctrPct, hint: 'Клики / показы' },
  { key: 'l2d', header: 'Лид → сделка', align: 'right', render: (r) => formatPct(r.leadToDealPct), sortValue: (r) => r.leadToDealPct },
  { key: 'l2w', header: 'Лид → продажа', align: 'right', render: (r) => formatPct(r.leadToWonPct), sortValue: (r) => r.leadToWonPct },
  { key: 'cac', header: 'CAC', align: 'right', render: (r) => formatMoney(r.cac, { compact: false }), sortValue: (r) => r.cac },
  { key: 'revenue', header: 'Выручка', align: 'right', render: (r) => formatMoney(r.revenue), sortValue: (r) => r.revenue, hint: 'С лидов периода' },
  { key: 'romi', header: 'ROMI', align: 'right', render: (r) => formatPct(r.romiPct, 0), sortValue: (r) => r.romiPct },
];

function SourceChart({ sources }: { sources: SourceRow[] }) {
  const theme = useChartTheme();
  const [metricId, setMetricId] = useState<MetricId>('cpl');
  const metric = METRICS.find((m) => m.id === metricId)!;
  const colors = colorMap(stableKeys(sources.map((s) => s.source), SOURCE_ORDER), theme);
  const data = sources.map((s) => ({ name: s.name, source: s.source, value: metric.get(s) }));
  return (
    <Card>
      <CardHeader
        title="Источники"
        subtitle="Цвет закреплён за источником во всех графиках"
        right={<Segmented size="sm" label="Метрика" value={metricId} options={METRICS} onChange={setMetricId} />}
      />
      <div className="px-3 pt-3 pb-4">
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40)}>
          <BarChart data={data} layout="vertical" margin={{ ...CHART_MARGIN, right: 24 }}>
            <CartesianGrid horizontal={false} stroke={theme.grid} />
            <XAxis type="number" {...valueAxisProps(theme)} />
            <YAxis type="category" dataKey="name" width={124} tick={{ fill: theme.ink2, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: theme.grid, opacity: 0.5 }}
              content={({ active, payload }: TooltipProps) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return <TooltipBox title={row.name} rows={[{ name: metric.label, value: metric.fmt(row.value), color: colors[row.source] }]} />;
              }}
            />
            <Bar isAnimationActive={false} dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((d) => (
                <Cell key={d.source} fill={colors[d.source]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function MonthlyCharts({ monthly }: { monthly: MarketingResponse['monthly'] }) {
  const theme = useChartTheme();
  const keys = stableKeys(monthly.sources.map((s) => s.code), SOURCE_ORDER);
  const colors = colorMap(keys, theme);
  const names = Object.fromEntries(monthly.sources.map((s) => [s.code, s.name]));
  if (monthly.totals.length === 0) return <Card><EmptyState text="Нет данных за период" /></Card>;
  const x = { dataKey: 'month', tickFormatter: formatMonth, ...axisProps(theme) };
  return (
    <Card>
      <CardHeader title="Динамика по месяцам" subtitle="Полные месяцы, пересекающие выбранный период (materialized view)" />
      <div className="grid gap-4 px-3 pt-3 pb-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
            <span className="text-xs font-medium text-ink-2">Лиды по источникам</span>
            <Legend items={keys.map((k) => ({ key: k, label: names[k] ?? k, color: colors[k]! }))} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly.leadsBySource} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis {...x} />
              <YAxis {...valueAxisProps(theme)} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.5 }}
                content={({ active, payload, label }: TooltipProps) =>
                  active && payload?.length ? (
                    <TooltipBox
                      title={formatMonth(String(label))}
                      rows={[...payload].reverse().map((p) => ({ name: names[String(p.dataKey)] ?? String(p.dataKey), value: formatNumber(Number(p.value)), color: p.color }))}
                    />
                  ) : null
                }
              />
              {keys.map((k, i) => (
                <Bar isAnimationActive={false} key={k} dataKey={k} stackId="leads" fill={colors[k]} stroke={theme.surface} strokeWidth={1} maxBarSize={28}
                  radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="mb-2 px-2 text-xs font-medium text-ink-2">CPL по всем каналам, ₽</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthly.totals} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis {...x} />
              <YAxis {...valueAxisProps(theme)} />
              <Tooltip
                cursor={{ stroke: theme.axis }}
                content={({ active, payload, label }: TooltipProps) => {
                  const t = payload?.[0]?.payload as MarketingResponse['monthly']['totals'][number] | undefined;
                  if (!active || !t) return null;
                  return (
                    <TooltipBox
                      title={formatMonth(String(label))}
                      rows={[
                        { name: 'CPL', value: formatMoney(t.cpl, { compact: false }) },
                        { name: 'Расход', value: formatMoney(t.spend) },
                        { name: 'Лиды', value: formatNumber(t.leads) },
                      ]}
                    />
                  );
                }}
              />
              <Line isAnimationActive={false} dataKey="cpl" stroke={theme.series[0]} strokeWidth={2} dot={{ r: 3, fill: theme.series[0], strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: theme.surface, strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export function MarketingTab({ filters }: { filters: Filters }) {
  const query = useAnalytics<MarketingResponse>('marketing', filters);
  return (
    <QueryView query={query}>
      {(data) => (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Эффективность источников" subtitle={data.attribution.cohort} />
            <div className="mt-2">
              <DataTable caption="Эффективность источников" rows={data.sources} columns={columns} rowKey={(r) => r.source}
                initialSort={{ key: 'leads', dir: 'desc' }} footer={data.total} />
            </div>
          </Card>
          <SourceChart sources={data.sources} />
          <MonthlyCharts monthly={data.monthly} />
        </div>
      )}
    </QueryView>
  );
}
