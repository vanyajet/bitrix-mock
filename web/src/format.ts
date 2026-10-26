// Только форматирование: никаких вычислений метрик на фронте.

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const DASH = '—';

export function formatNumber(v: number | null | undefined): string {
  return v === null || v === undefined ? DASH : nf.format(v);
}

export function formatCompact(v: number | null | undefined): string {
  return v === null || v === undefined ? DASH : compact.format(v);
}

/** 980 ₽ · 45,2 тыс. ₽ · 12,3 млн ₽ */
export function formatMoney(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined) return DASH;
  const abs = Math.abs(v);
  if (opts.compact !== false && abs >= 1_000_000) return `${nf1.format(v / 1_000_000)} млн ₽`;
  if (opts.compact && abs >= 10_000) return `${nf1.format(v / 1_000)} тыс. ₽`;
  return `${nf.format(v)} ₽`;
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return DASH;
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} %`;
}

export function formatValue(v: number | null, format: 'number' | 'money' | 'percent'): string {
  if (format === 'money') return formatMoney(v);
  if (format === 'percent') return formatPct(v);
  return formatNumber(v);
}

export function formatDelta(delta: number, unit: 'pct' | 'pp'): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${nf1.format(Math.abs(delta))} ${unit === 'pp' ? 'п.п.' : '%'}`;
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return DASH;
  return h < 48 ? `${nf1.format(h)} ч` : `${nf1.format(h / 24)} дн`;
}

export function formatMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return DASH;
  return m < 90 ? `${nf.format(m)} мин` : `${nf1.format(m / 60)} ч`;
}

const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "2026-10" -> "окт. 26" */
export const formatMonth = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`)).replace(' г.', '');
/** "2026-07-27" -> "27 июл." */
export const formatDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`)).replace(' г.', '');
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function formatAgo(iso: string, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} ч назад`;
  return `${Math.floor(sec / 86_400)} дн назад`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return DASH;
  return ms < 60_000 ? `${nf1.format(ms / 1000)} с` : `${nf1.format(ms / 60_000)} мин`;
}
