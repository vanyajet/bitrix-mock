import { useState } from 'react';
import { RANGE_PRESETS, TABS, presetRange, type Filters, type TabId } from '../filters';
import { formatDate } from '../format';
import type { MetaResponse, Vertical } from '../types';
import { Segmented } from './ui';

const VERTICAL_OPTIONS: ReadonlyArray<{ id: Vertical; label: string }> = [
  { id: 'dental', label: 'Стоматология' },
  { id: 'metal', label: 'Металлоконструкции' },
];

function CustomRange({ filters, onApply }: { filters: Filters; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const valid = from && to && from <= to;
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Начало периода"
        className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" />
      <span className="text-muted">—</span>
      <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Конец периода"
        className="rounded-lg border border-line bg-surface px-2 py-1 text-ink" />
      <button type="submit" disabled={!valid}
        className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-40">
        Применить
      </button>
    </form>
  );
}

export function Header({ filters, update, meta }: { filters: Filters; update: (p: Partial<Filters>) => void; meta?: MetaResponse }) {
  const segments = meta?.verticals.find((v) => v.code === filters.vertical)?.segments ?? [];
  const rangeOptions = [...RANGE_PRESETS.map((r) => ({ id: r.id, label: r.label })), { id: 'custom', label: 'Свой период' }];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto max-w-[1400px] px-4 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-white" aria-hidden>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 19V12M10 19V6M15 19v-5M20 19V9" />
              </svg>
            </div>
            <div>
              <div className="text-[15px] leading-tight font-semibold text-ink">CRM Analytics</div>
              <div className="text-[11px] text-muted">Bitrix24 → PostgreSQL · демо</div>
            </div>
          </div>
          <Segmented label="Вертикаль" value={filters.vertical} options={VERTICAL_OPTIONS}
            onChange={(vertical) => update({ vertical, segment: '' })} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented label="Период" size="sm" value={filters.range} options={rangeOptions}
            onChange={(range) => {
              const preset = RANGE_PRESETS.find((r) => r.id === range);
              update(preset ? { range, ...presetRange(preset.days) } : { range: 'custom' });
            }} />
          <select value={filters.segment} onChange={(e) => update({ segment: e.target.value })} aria-label="Сегмент"
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink">
            <option value="">Все сегменты</option>
            {segments.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {formatDate(filters.from)} — {formatDate(filters.to)}
          </span>
        </div>
        {filters.range === 'custom' && (
          <div className="mt-2">
            <CustomRange key={`${filters.from}-${filters.to}`} filters={filters} onApply={(from, to) => update({ range: 'custom', from, to })} />
          </div>
        )}

        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto" aria-label="Разделы">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => update({ tab: t.id as TabId })} aria-current={filters.tab === t.id ? 'page' : undefined}
              className={`border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium whitespace-nowrap transition-colors ${
                filters.tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
              }`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
