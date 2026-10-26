// Общая реализация list-методов Bitrix24: filter с префиксами-операторами, order, select, постраничность по 50.

import { formatBitrixDate } from './time.js';

export const PAGE_SIZE = 50;

export type FieldType = 'int' | 'string' | 'datetime' | 'money';
export type Row = Record<string, string | number | null>;

export interface EntityDef {
  fields: Record<string, FieldType>;
  /** Новые методы (crm.stagehistory.list) отдают числа числами, классические - строками. */
  intAsNumber?: boolean;
}

export class BitrixMockError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly description: string,
  ) {
    super(description);
  }
}

export interface ListParams {
  filter?: unknown;
  order?: unknown;
  select?: unknown;
  start?: unknown;
}

type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | '!in' | 'like';
interface Condition {
  field: string;
  op: Op;
  values: Array<string | number>;
}

const OPS: Record<string, Op> = { '': '=', '=': '=', '!': '!=', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=', '@': 'in', '!@': '!in', '%': 'like' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?)?$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function convert(field: string, type: FieldType, raw: unknown): string | number {
  if (type === 'string') return String(raw);
  if (type === 'datetime') {
    const str = String(raw);
    const ms = ISO_DATE.test(str) ? Date.parse(str) : Number.NaN;
    if (Number.isNaN(ms)) throw new BitrixMockError(400, 'INVALID_ARG_VALUE', `Invalid date value for filter field ${field}: "${str}"`);
    return ms;
  }
  const num = Number(raw);
  if (Number.isNaN(num)) throw new BitrixMockError(400, 'INVALID_ARG_VALUE', `Invalid numeric value for filter field ${field}: "${String(raw)}"`);
  return num;
}

function parseFilter(filter: unknown, def: EntityDef): Condition[] {
  const conditions: Condition[] = [];
  for (const [key, raw] of Object.entries(asRecord(filter))) {
    const match = /^(>=|<=|!=|!@|>|<|=|!|@|%)?(.+)$/.exec(key);
    if (!match) continue;
    const field = match[2]!;
    const type = def.fields[field];
    if (!type) continue; // неизвестные поля Bitrix молча игнорирует
    let op = OPS[match[1] ?? '']!;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [raw];
    if (Array.isArray(raw) && op === '=') op = 'in';
    if (Array.isArray(raw) && op === '!=') op = '!in';
    conditions.push({ field, op, values: list.map((v) => convert(field, type, v)) });
  }
  return conditions;
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

function matches(row: Row, c: Condition): boolean {
  const v = row[c.field] ?? null;
  const first = c.values[0] ?? null;
  switch (c.op) {
    case '=':
      return v !== null && String(v) === String(first);
    case '!=':
      return v === null || String(v) !== String(first);
    case 'in':
      return v !== null && c.values.some((x) => String(x) === String(v));
    case '!in':
      return v === null || !c.values.some((x) => String(x) === String(v));
    case 'like':
      return v !== null && String(v).toLowerCase().includes(String(first).toLowerCase());
    default: {
      if (v === null || first === null) return false;
      const cmp = compare(v, first);
      return c.op === '>' ? cmp > 0 : c.op === '>=' ? cmp >= 0 : c.op === '<' ? cmp < 0 : cmp <= 0;
    }
  }
}

function parseOrder(order: unknown, def: EntityDef): Array<[string, 1 | -1]> {
  const keys: Array<[string, 1 | -1]> = [];
  for (const [field, dir] of Object.entries(asRecord(order))) {
    if (def.fields[field]) keys.push([field, String(dir).toUpperCase() === 'DESC' ? -1 : 1]);
  }
  if (!keys.some(([f]) => f === 'ID')) keys.push(['ID', 1]);
  return keys;
}

function resolveSelect(select: unknown, def: EntityDef): string[] {
  const all = Object.keys(def.fields);
  const requested = Array.isArray(select) ? select.map(String) : typeof select === 'string' ? [select] : [];
  const standard = all.filter((f) => !f.startsWith('UF_'));
  if (requested.length === 0) return standard;
  const result = new Set<string>(['ID']);
  for (const f of requested) {
    if (f === '*') standard.forEach((s) => result.add(s));
    else if (f === 'UF_*') all.filter((s) => s.startsWith('UF_')).forEach((s) => result.add(s));
    else if (def.fields[f]) result.add(f);
  }
  return [...result];
}

function serialize(row: Row, fields: string[], def: EntityDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f] ?? null;
    const type = def.fields[f];
    if (v === null) out[f] = null;
    else if (type === 'datetime') out[f] = formatBitrixDate(v as number);
    else if (type === 'money') out[f] = (v as number).toFixed(2);
    else if (type === 'int') out[f] = def.intAsNumber ? v : String(v);
    else out[f] = v;
  }
  return out;
}

export interface ListResult {
  items: Array<Record<string, unknown>>;
  total?: number;
  next?: number;
}

/**
 * memo кэширует отфильтрованный и отсортированный набор в рамках одного снапшота:
 * 50 подзапросов batch с разным start не пересортировывают 20 тыс. записей каждый раз.
 */
export function runList(rows: Row[], params: ListParams, def: EntityDef, memo?: Map<string, Row[]>): ListResult {
  const key = JSON.stringify([params.filter ?? null, params.order ?? null]);
  let sorted = memo?.get(key);
  if (!sorted) {
    const conditions = parseFilter(params.filter, def);
    const order = parseOrder(params.order, def);
    sorted = rows
      .filter((row) => conditions.every((c) => matches(row, c)))
      .sort((a, b) => {
        for (const [field, dir] of order) {
          const cmp = compare(a[field] ?? null, b[field] ?? null);
          if (cmp !== 0) return cmp * dir;
        }
        return 0;
      });
    memo?.set(key, sorted);
  }

  const startNum = Number(params.start ?? 0);
  const noCount = startNum === -1;
  const start = noCount || !Number.isFinite(startNum) || startNum < 0 ? 0 : Math.floor(startNum);
  const fields = resolveSelect(params.select, def);
  const items = sorted.slice(start, start + PAGE_SIZE).map((row) => serialize(row, fields, def));
  if (noCount) return { items };
  const next = start + PAGE_SIZE < sorted.length ? start + PAGE_SIZE : undefined;
  return { items, total: sorted.length, next };
}
