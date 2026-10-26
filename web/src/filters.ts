import { useCallback, useSyncExternalStore } from 'react';
import type { Vertical } from './types';

// Состояние фильтров живёт в URL: ссылку на конкретный срез можно отправить коллеге.

export const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'marketing', label: 'Маркетинг' },
  { id: 'funnel', label: 'Воронка' },
  { id: 'finance', label: 'Финансы' },
  { id: 'team', label: 'Команда' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export const RANGE_PRESETS = [
  { id: '7', label: '7 дней', days: 7 },
  { id: '30', label: '30 дней', days: 30 },
  { id: '90', label: '90 дней', days: 90 },
  { id: '365', label: 'Год', days: 365 },
] as const;

export interface Filters {
  tab: TabId;
  vertical: Vertical;
  range: string; // id пресета или 'custom'
  from: string;
  to: string;
  segment: string;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
};
const getSearch = () => window.location.search;

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Границы пресета "последние N дней" включая сегодня. */
export function presetRange(days: number): { from: string; to: string } {
  const to = isoToday();
  return { from: shiftDays(to, -(days - 1)), to };
}

function parse(search: string): Filters {
  const q = new URLSearchParams(search);
  const tab = (TABS.find((t) => t.id === q.get('tab'))?.id ?? 'overview') as TabId;
  const vertical: Vertical = q.get('vertical') === 'metal' ? 'metal' : 'dental';
  const preset = RANGE_PRESETS.find((r) => r.id === q.get('range'));
  const custom = q.get('range') === 'custom' && q.get('from') && q.get('to');
  const range = custom ? 'custom' : (preset?.id ?? '90');
  const { from, to } = custom ? { from: q.get('from')!, to: q.get('to')! } : presetRange(preset?.days ?? 90);
  return { tab, vertical, range, from, to, segment: q.get('segment') ?? '' };
}

export function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const search = useSyncExternalStore(subscribe, getSearch);
  const filters = parse(search);
  const update = useCallback((patch: Partial<Filters>) => {
    const next = { ...parse(window.location.search), ...patch };
    const q = new URLSearchParams();
    if (next.tab !== 'overview') q.set('tab', next.tab);
    q.set('vertical', next.vertical);
    q.set('range', next.range);
    if (next.range === 'custom') {
      q.set('from', next.from);
      q.set('to', next.to);
    }
    if (next.segment) q.set('segment', next.segment);
    window.history.pushState(null, '', `?${q}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return [filters, update];
}

/** Параметры запроса к API из фильтров. */
export function apiParams(f: Filters): Record<string, string | undefined> {
  return { vertical: f.vertical, from: f.from, to: f.to, segment: f.segment || undefined };
}
