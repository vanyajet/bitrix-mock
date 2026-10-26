import { useSyncExternalStore } from 'react';

// Recharts рисует SVG-атрибутами, поэтому цвета берём из CSS-переменных темы в JS
// и пересчитываем при смене светлой/тёмной схемы.

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (cb: () => void) => {
  media?.addEventListener('change', cb);
  return () => media?.removeEventListener('change', cb);
};
const getDark = () => media?.matches ?? false;

const LIGHT = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  neutral: '#c3c2b7',
};

const DARK: typeof LIGHT = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  surface: '#1a1a19',
  ink: '#f0efec',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  neutral: '#4a4a46',
};

export type ChartTheme = typeof LIGHT;

export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getDark) ? DARK : LIGHT;
}

/**
 * Цвет закреплён за сущностью, а не за её местом в рейтинге: порядок слотов задаётся
 * стабильным списком ключей (источники - фиксированный список, сегменты - по алфавиту,
 * сотрудники - по ID), поэтому фильтры не перекрашивают графики.
 */
export function colorMap(keys: string[], theme: ChartTheme): Record<string, string> {
  return Object.fromEntries(keys.map((k, i) => [k, theme.series[i % theme.series.length]!]));
}

export const SOURCE_ORDER = ['yandex_direct', 'google_ads', 'instagram', 'seo', 'referral', 'cold_call'];

export function stableKeys(keys: string[], order?: string[]): string[] {
  if (order) return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return [...keys].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}
