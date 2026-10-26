// Время mock-портала: Москва, UTC+3 без перехода на летнее время, поэтому хватает фиксированного смещения.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const OFFSET = 3 * HOUR;

/** Номер календарного дня портала (дни с 1970-01-01 по московскому времени). */
export function dayNoOf(ms: number): number {
  return Math.floor((ms + OFFSET) / DAY);
}

export function dayStartMs(dayNo: number): number {
  return dayNo * DAY - OFFSET;
}

export function dayNoFromIso(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / DAY);
}

export function isoDateOf(dayNo: number): string {
  return new Date(dayNo * DAY).toISOString().slice(0, 10);
}

export interface LocalParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  /** 1 = понедельник ... 7 = воскресенье */
  dow: number;
  daysInMonth: number;
}

export function localParts(ms: number): LocalParts {
  const d = new Date(ms + OFFSET);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return {
    year,
    month,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    dow: ((d.getUTCDay() + 6) % 7) + 1,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Формат дат Bitrix24 REST: 2026-10-26T12:30:00+03:00 */
export function formatBitrixDate(ms: number): string {
  const d = new Date(ms + OFFSET);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+03:00`
  );
}
