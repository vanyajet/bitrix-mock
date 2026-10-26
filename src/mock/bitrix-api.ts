// Mock Bitrix24 REST API в формате входящего вебхука: /mock/rest/<user_id>/<token>/<method>.json
// Повторяет поведение реального портала, на котором спотыкаются интеграции: строки вместо чисел,
// пагинация по 50 через next, лимит 2 запроса/сек с QUERY_LIMIT_EXCEEDED, batch с пустыми [] вместо {}.

import type { FastifyInstance } from 'fastify';
import qs from 'qs';
import { BitrixMockError, runList, type ListParams, type Row } from './list-engine.js';
import { categoryRows, segmentUserFieldRows, statusRows, userRows } from './reference.js';
import {
  DEAL_DEF,
  DEAL_HISTORY_DEF,
  LEAD_DEF,
  LEAD_HISTORY_DEF,
  SEGMENT_FIELD,
  type MockStore,
  type Snapshot,
} from './store.js';
import { formatBitrixDate } from './time.js';

export interface MockBitrixOptions {
  store: MockStore;
  token: string;
  /** Лимит запросов в секунду на токен, как у реального портала. */
  rateLimitRps: number;
}

type Params = Record<string, unknown>;

interface MethodResult {
  result: unknown;
  total?: number;
  next?: number;
}

const QS_OPTIONS = { arrayLimit: 1000, depth: 5, parameterLimit: 5000 } as const;
const MAX_BATCH = 50;

/** Скользящее окно в 1 секунду на токен. Отклонённые запросы в окно не засчитываются. */
class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number) {}

  tryAcquire(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

function timing(startedAt: number): Record<string, unknown> {
  const finish = Date.now();
  return {
    start: startedAt / 1000,
    finish: finish / 1000,
    duration: (finish - startedAt) / 1000,
    processing: (finish - startedAt) / 1000,
    date_start: formatBitrixDate(startedAt),
    date_finish: formatBitrixDate(finish),
  };
}

/** PHP сериализует пустой ассоциативный массив как [], и клиенты обязаны это переживать. */
function phpObject(obj: Record<string, unknown>): Record<string, unknown> | [] {
  return Object.keys(obj).length > 0 ? obj : [];
}

function memoFor(snap: Snapshot, entity: string): Map<string, Row[]> {
  let memo = snap.memo.get(entity);
  if (!memo) snap.memo.set(entity, (memo = new Map()));
  return memo;
}

function entityTypeId(params: Params): number {
  return Number(params.entityTypeId ?? params.ENTITY_TYPE_ID ?? Number.NaN);
}

function list(rows: Row[], params: Params, def: typeof LEAD_DEF, memo: Map<string, Row[]>): MethodResult {
  const { items, total, next } = runList(rows, params as ListParams, def, memo);
  return { result: items, total, next };
}

function createMethods(store: MockStore): Record<string, (params: Params) => MethodResult> {
  return {
    'crm.lead.list': (p) => {
      const snap = store.snapshot();
      return list(snap.leads(), p, LEAD_DEF, memoFor(snap, 'lead'));
    },
    'crm.deal.list': (p) => {
      const snap = store.snapshot();
      return list(snap.deals(), p, DEAL_DEF, memoFor(snap, 'deal'));
    },
    'crm.stagehistory.list': (p) => {
      const type = entityTypeId(p);
      if (type !== 1 && type !== 2) {
        throw new BitrixMockError(400, 'INVALID_ARG_VALUE', 'entityTypeId must be 1 (lead) or 2 (deal) in this portal');
      }
      const snap = store.snapshot();
      const { items, total, next } = runList(
        type === 1 ? snap.leadHistory() : snap.dealHistory(),
        p as ListParams,
        type === 1 ? LEAD_HISTORY_DEF : DEAL_HISTORY_DEF,
        memoFor(snap, `history-${type}`),
      );
      return { result: { items }, total, next };
    },
    'crm.status.list': (p) => {
      const filter = (p.filter ?? {}) as Record<string, unknown>;
      const rows = statusRows().filter(
        (r) =>
          (filter.ENTITY_ID === undefined || r.ENTITY_ID === String(filter.ENTITY_ID)) &&
          (filter.STATUS_ID === undefined || r.STATUS_ID === String(filter.STATUS_ID)),
      );
      return { result: rows, total: rows.length };
    },
    'crm.category.list': (p) => {
      if (entityTypeId(p) !== 2) {
        throw new BitrixMockError(400, 'NOT_FOUND', 'Categories are supported only for deals (entityTypeId=2) in this portal');
      }
      const categories = categoryRows();
      return { result: { categories }, total: categories.length };
    },
    'user.get': (p) => {
      const users = userRows();
      const start = Math.max(0, Number(p.start ?? 0) || 0);
      const page = users.slice(start, start + 50);
      return { result: page, total: users.length, next: start + 50 < users.length ? start + 50 : undefined };
    },
    'crm.lead.userfield.list': () => ({ result: segmentUserFieldRows('lead', SEGMENT_FIELD), total: 1 }),
    'crm.deal.userfield.list': () => ({ result: segmentUserFieldRows('deal', SEGMENT_FIELD), total: 1 }),
  };
}

function runBatch(params: Params, methods: ReturnType<typeof createMethods>): MethodResult {
  const cmd = (params.cmd ?? {}) as Record<string, unknown>;
  const entries = Object.entries(cmd);
  if (entries.length > MAX_BATCH) {
    throw new BitrixMockError(400, 'ERROR_BATCH_LENGTH_EXCEEDED', `Max batch length exceeded (${MAX_BATCH})`);
  }
  const halt = Number(params.halt ?? 0) === 1;
  const result: Record<string, unknown> = {};
  const errors: Record<string, unknown> = {};
  const totals: Record<string, unknown> = {};
  const nexts: Record<string, unknown> = {};
  const times: Record<string, unknown> = {};

  for (const [key, command] of entries) {
    const started = Date.now();
    const raw = String(command);
    const q = raw.indexOf('?');
    const method = (q === -1 ? raw : raw.slice(0, q)).replace(/\.json$/, '');
    const subParams = q === -1 ? {} : (qs.parse(raw.slice(q + 1), QS_OPTIONS) as Params);
    try {
      const handler = method === 'batch' ? undefined : methods[method];
      if (!handler) throw new BitrixMockError(404, 'ERROR_METHOD_NOT_FOUND', `Method not found: ${method}`);
      const r = handler(subParams);
      result[key] = r.result;
      if (r.total !== undefined) totals[key] = r.total;
      if (r.next !== undefined) nexts[key] = r.next;
      times[key] = timing(started);
    } catch (err) {
      if (!(err instanceof BitrixMockError)) throw err;
      errors[key] = { error: err.error, error_description: err.description };
      if (halt) break;
    }
  }
  return {
    result: {
      result: phpObject(result),
      result_error: phpObject(errors),
      result_total: phpObject(totals),
      result_next: phpObject(nexts),
      result_time: phpObject(times),
    },
  };
}

export async function mockBitrixRoutes(app: FastifyInstance, opts: MockBitrixOptions): Promise<void> {
  const methods = createMethods(opts.store);
  const limiter = new SlidingWindowLimiter(opts.rateLimitRps);

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, qs.parse(body as string, QS_OPTIONS));
  });

  app.route<{ Params: { userId: string; token: string; method: string } }>({
    method: ['GET', 'POST'],
    url: '/rest/:userId/:token/:method',
    handler: async (req, reply) => {
      const started = Date.now();
      const { userId, token } = req.params;
      if (userId !== '1' || token !== opts.token) {
        return reply.code(401).send({ error: 'INVALID_CREDENTIALS', error_description: 'Invalid request credentials' });
      }
      if (!limiter.tryAcquire(token)) {
        return reply.code(503).send({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' });
      }

      const method = req.params.method.replace(/\.json$/, '');
      const params: Params = {
        ...((req.query as Params | undefined) ?? {}),
        ...(req.body && typeof req.body === 'object' ? (req.body as Params) : {}),
      };
      try {
        const handler = method === 'batch' ? (p: Params) => runBatch(p, methods) : methods[method];
        if (!handler) throw new BitrixMockError(404, 'ERROR_METHOD_NOT_FOUND', 'Method not found!');
        const { result, total, next } = handler(params);
        return reply.send({ result, ...(next !== undefined && { next }), ...(total !== undefined && { total }), time: timing(started) });
      } catch (err) {
        if (err instanceof BitrixMockError) {
          return reply.code(err.status).send({ error: err.error, error_description: err.description });
        }
        throw err;
      }
    },
  });
}
