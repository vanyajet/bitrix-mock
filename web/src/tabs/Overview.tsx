import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_MARGIN, TooltipBox, valueAxisProps, type TooltipProps } from '../components/charts';
import { KpiCard } from '../components/KpiCard';
import { Card, CardHeader, QueryView } from '../components/ui';
import type { Filters } from '../filters';
import { formatDay, formatMoney, formatNumber } from '../format';
import { useAnalytics } from '../queries';
import { useChartTheme } from '../theme';
import type { OverviewResponse } from '../types';

type Week = OverviewResponse['weekly'][number];

function WeekTooltip({ active, payload }: TooltipProps) {
  const w = payload?.[0]?.payload as Week | undefined;
  if (!active || !w) return null;
  return (
    <TooltipBox
      title={`Неделя с ${formatDay(w.week)}`}
      rows={[
        { name: 'Лиды', value: formatNumber(w.leads) },
        { name: 'Сделок выиграно', value: formatNumber(w.wonDeals) },
        { name: 'Выручка', value: formatMoney(w.revenue, { compact: false }) },
      ]}
    />
  );
}

/** Лиды и выручка - разные единицы, поэтому два графика с общей осью времени вместо двух осей Y. */
function WeeklyCharts({ weekly }: { weekly: Week[] }) {
  const theme = useChartTheme();
  const x = { dataKey: 'week', tickFormatter: formatDay, ...axisProps(theme), minTickGap: 24 };
  return (
    <Card>
      <CardHeader title="Динамика по неделям" subtitle="Лиды - по дате создания, выручка - по дате закрытия сделки. Крайние недели могут быть неполными." />
      <div className="grid gap-2 px-3 pt-3 pb-4 lg:grid-cols-2">
        <div>
          <div className="px-2 text-xs font-medium text-ink-2">Лиды</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekly} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis {...x} />
              <YAxis {...valueAxisProps(theme)} allowDecimals={false} />
              <Tooltip content={<WeekTooltip />} cursor={{ fill: theme.grid, opacity: 0.5 }} />
              <Bar isAnimationActive={false} dataKey="leads" fill={theme.series[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="px-2 text-xs font-medium text-ink-2">Выручка, ₽</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={weekly} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis {...x} />
              <YAxis {...valueAxisProps(theme)} />
              <Tooltip content={<WeekTooltip />} cursor={{ stroke: theme.axis }} />
              <Area isAnimationActive={false} dataKey="revenue" type="monotone" stroke={theme.series[2]} strokeWidth={2} fill={theme.series[2]} fillOpacity={0.1}
                activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export function OverviewTab({ filters }: { filters: Filters }) {
  const query = useAnalytics<OverviewResponse>('overview', filters);
  return (
    <QueryView query={query}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {data.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
          </div>
          <WeeklyCharts weekly={data.weekly} />
          <p className="text-xs text-muted">{data.attribution.cohort} {data.attribution.closed}</p>
        </div>
      )}
    </QueryView>
  );
}
