import { z } from 'zod';
import { toBitrixDate } from '../bitrix/dates.js';
import { VERTICALS, type Vertical } from '../config/domain.js';
import { HttpError } from './errors.js';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 731;
const DEFAULT_RANGE_DAYS = 90;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'invalid date');

export const AnalyticsQuery = z
  .object({
    vertical: z.enum(VERTICALS).default('dental'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    segment: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((s) => (s ? s : undefined)),
  })
  .strict();

export interface Period {
  vertical: Vertical;
  /** Включительные границы в датах часового пояса бизнеса. */
  from: string;
  to: string;
  days: number;
  /** Предыдущий период той же длины - для дельт. */
  prevFrom: string;
  prevTo: string;
  segment: string | null;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export function resolvePeriod(query: unknown, timeZone: string, now = new Date()): Period {
  const q = AnalyticsQuery.parse(query ?? {});
  const today = toBitrixDate(now, timeZone).slice(0, 10);
  const to = q.to ?? (q.from ? addDays(q.from, DEFAULT_RANGE_DAYS - 1) : today);
  const from = q.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) throw new HttpError(400, 'VALIDATION_ERROR', '"from" must not be later than "to"');
  const days = diffDays(from, to) + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, 'VALIDATION_ERROR', `period must not exceed ${MAX_RANGE_DAYS} days`);
  const prevTo = addDays(from, -1);
  return { vertical: q.vertical, from, to, days, prevFrom: addDays(prevTo, -(days - 1)), prevTo, segment: q.segment ?? null };
}

export function cacheKey(route: string, p: Period): string {
  return `${route}|${p.vertical}|${p.from}|${p.to}|${p.segment ?? ''}`;
}
