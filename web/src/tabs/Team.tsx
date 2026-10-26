import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_MARGIN, Legend, TooltipBox, valueAxisProps, type TooltipProps } from '../components/charts';
import { DataTable, MiniBar, type Column } from '../components/DataTable';
import { Card, CardHeader, EmptyState, QueryView } from '../components/ui';
import type { Filters } from '../filters';
import { formatMinutes, formatMoney, formatMonth, formatNumber, formatPct } from '../format';
import { useAnalytics } from '../queries';
import { colorMap, useChartTheme } from '../theme';
import type { TeamMember, TeamResponse } from '../types';

function columns(members: TeamMember[]): Column<TeamMember>[] {
  const maxConv = Math.max(0, ...members.map((m) => m.conversionPct ?? 0));
  const maxShare = Math.max(0, ...members.map((m) => m.revenueSharePct ?? 0));
  return [
    {
      key: 'name',
      header: 'Специалист',
      render: (m) => (
        <div>
          <div className="font-medium">{m.name}</div>
          <div className="text-xs text-muted">{m.position}</div>
        </div>
      ),
      sortValue: (m) => m.name,
    },
    { key: 'leads', header: 'Лидов получено', align: 'right', render: (m) => formatNumber(m.leads), sortValue: (m) => m.leads },
    {
      key: 'conv',
      header: 'Конверсия',
      align: 'right',
      hint: 'Доля лидов периода, ставших выигранными сделками',
      render: (m) => <MiniBar value={m.conversionPct} max={maxConv} label={formatPct(m.conversionPct)} />,
      sortValue: (m) => m.conversionPct,
    },
    { key: 'won', header: 'Выиграно', align: 'right', render: (m) => formatNumber(m.wonDeals), sortValue: (m) => m.wonDeals, hint: 'Сделки, закрытые в периоде' },
    { key: 'revenue', header: 'Выручка', align: 'right', render: (m) => formatMoney(m.revenue), sortValue: (m) => m.revenue },
    {
      key: 'share',
      header: 'Доля выручки',
      align: 'right',
      render: (m) => <MiniBar value={m.revenueSharePct} max={maxShare} label={formatPct(m.revenueSharePct)} color="var(--ink-2)" />,
      sortValue: (m) => m.revenueSharePct,
    },
    { key: 'check', header: 'Средний чек', align: 'right', render: (m) => formatMoney(m.avgCheck, { compact: true }), sortValue: (m) => m.avgCheck },
    {
      key: 'speed',
      header: 'Реакция на лид',
      align: 'right',
      hint: 'Время от создания лида до взятия в работу: медиана (среднее). Ночные заявки ждут утра, поэтому среднее выше.',
      render: (m) => (
        <span>
          {formatMinutes(m.medianResponseMin)} <span className="text-muted">({formatMinutes(m.avgResponseMin)})</span>
        </span>
      ),
      sortValue: (m) => m.medianResponseMin,
    },
    { key: 'na', header: 'Не дозвонились', align: 'right', render: (m) => formatPct(m.noAnswerPct), sortValue: (m) => m.noAnswerPct },
  ];
}

function MonthlyRevenue({ data }: { data: TeamResponse['monthlyRevenue'] }) {
  const theme = useChartTheme();
  const users = [...data.users].sort((a, b) => Number(a.id) - Number(b.id));
  const colors = colorMap(users.map((u) => u.id), theme);
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return (
    <Card>
      <CardHeader title="Выручка специалистов по месяцам" subtitle="По дате закрытия сделки"
        right={<Legend items={users.map((u) => ({ key: u.id, label: u.name, color: colors[u.id]! }))} />} />
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
                      rows={[...payload].reverse().map((p) => ({ name: names[String(p.dataKey)] ?? String(p.dataKey), value: formatMoney(Number(p.value)), color: p.color }))} />
                  ) : null
                }
              />
              {users.map((u, i) => (
                <Bar isAnimationActive={false} key={u.id} dataKey={u.id} stackId="rev" fill={colors[u.id]} stroke={theme.surface} strokeWidth={1} maxBarSize={32}
                  radius={i === users.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function TeamTab({ filters }: { filters: Filters }) {
  const query = useAnalytics<TeamResponse>('team', filters);
  return (
    <QueryView query={query}>
      {(data) => (
        <div className="space-y-4">
          <Card>
            <CardHeader title={filters.vertical === 'dental' ? 'Врачи и специалисты' : 'Менеджеры'}
              subtitle="Лиды и конверсия - по лидам, полученным в периоде; выручка и чек - по сделкам, закрытым в периоде. Кликните заголовок для сортировки." />
            <div className="mt-2">
              {data.members.length === 0 ? <EmptyState text="Нет данных за период" /> : (
                <DataTable caption="Показатели специалистов" rows={data.members} columns={columns(data.members)} rowKey={(m) => String(m.id)}
                  initialSort={{ key: 'revenue', dir: 'desc' }} />
              )}
            </div>
          </Card>
          <MonthlyRevenue data={data.monthlyRevenue} />
        </div>
      )}
    </QueryView>
  );
}
