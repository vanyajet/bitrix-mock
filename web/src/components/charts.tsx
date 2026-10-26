import type { ReactNode } from 'react';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { formatCompact } from '../format';
import type { ChartTheme } from '../theme';

export interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

/** Общий тултип: значения - цветом текста, идентичность - цветной меткой рядом. */
export function TooltipBox({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium text-ink">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              {r.color && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />}
              {r.name}
            </span>
            <span className="tabular font-medium text-ink">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-muted">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ key: string; label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          {i.dashed ? (
            <span className="h-0.5 w-4 rounded" style={{ background: i.color }} />
          ) : (
            <span className="size-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Общие пропсы осей: тонкие, приглушённые, компактные подписи (1 тыс., 2 млн). */
export function axisProps(theme: ChartTheme) {
  return {
    tick: { fill: theme.muted, fontSize: 11 },
    axisLine: { stroke: theme.axis },
    tickLine: false,
  } as const;
}

export function valueAxisProps(theme: ChartTheme, formatter: (v: number) => string = formatCompact) {
  return {
    tick: { fill: theme.muted, fontSize: 11 },
    axisLine: false,
    tickLine: false,
    width: 56,
    tickFormatter: formatter,
  } as const;
}

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/** Пропсы кастомного тултипа Recharts (в виде элемента часть пропсов приходит позже - поэтому Partial). */
export type TooltipProps = Partial<TooltipContentProps<ValueType, NameType>>;
