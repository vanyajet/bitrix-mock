import { useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Значение для сортировки; без него колонка не сортируется. */
  sortValue?: (row: T) => number | string | null;
  align?: 'left' | 'right';
  className?: string;
  hint?: string;
}

/** Таблица с сортировкой по клику на заголовок (сортировка - отображение, не вычисление метрик). */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  footer,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  footer?: T;
  caption: string;
}) {
  const [sort, setSort] = useState(initialSort);
  const column = columns.find((c) => c.key === sort?.key);
  const sorted =
    column?.sortValue && sort
      ? [...rows].sort((a, b) => {
          const va = column.sortValue!(a);
          const vb = column.sortValue!(b);
          if (va === vb) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va < vb ? -1 : 1) * (sort.dir === 'asc' ? 1 : -1);
        })
      : rows;

  const toggle = (c: Column<T>) => {
    if (!c.sortValue) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: 'desc' }));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`px-3 py-2.5 font-medium whitespace-nowrap first:pl-5 last:pr-5 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.sortValue ? (
                    <button
                      onClick={() => toggle(c)}
                      title={c.hint}
                      className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
                    >
                      {c.header}
                      <span className="text-[9px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : (
                    <span title={c.hint}>{c.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`tabular px-3 py-2.5 whitespace-nowrap text-ink first:pl-5 last:pr-5 ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-line bg-surface-2/50 font-medium">
              {columns.map((c) => (
                <td key={c.key} className={`tabular px-3 py-2.5 whitespace-nowrap text-ink first:pl-5 last:pr-5 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.render(footer)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Мини-бар: длина пропорциональна значению относительно максимума в колонке. */
export function MiniBar({ value, max, label, color = 'var(--accent)' }: { value: number | null; max: number; label: string; color?: string }) {
  const width = value !== null && max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="w-14 text-right">{label}</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </span>
    </div>
  );
}
