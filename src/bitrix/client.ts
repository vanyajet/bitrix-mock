// HTTP-клиент Bitrix24 REST по URL входящего вебхука. Код синка не знает, mock это или реальный портал:
// отличается только базовый URL.

import qs from 'qs';
import type { Logger } from '../logger.js';
import { BitrixApiError, isAbortError, isRetryableCode } from './errors.js';
import { RateLimiter } from './rate-limiter.js';
import { sleep as defaultSleep, withRetry, type Sleep } from './retry.js';

export const BITRIX_PAGE_SIZE = 50;
const MAX_BATCH_COMMANDS = 50;

export type BitrixParams = Record<string, unknown>;

export interface BitrixResponse<T = unknown> {
  result: T;
  next?: number;
  total?: number;
}

export interface BitrixPage<T> {
  items: T[];
  total?: number;
}

export interface BitrixClientOptions {
  /** https://portal.bitrix24.ru/rest/1/<token>/ */
  webhookUrl: string;
  rateLimitRps?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetch?: typeof fetch;
  sleep?: Sleep;
  random?: () => number;
  logger?: Logger;
}

export interface ListOptions<T> {
  /** Достаёт массив записей из result (например, result.items у crm.stagehistory.list). */
  extract?: (result: unknown) => T[];
  /** >1 - догружать остальные страницы пачками через batch (по N страниц за HTTP-запрос). */
  batchPages?: number;
  signal?: AbortSignal;
}

interface BatchResult {
  result: Record<string, unknown>;
  result_error: Record<string, { error: string; error_description?: string }>;
  result_total: Record<string, number>;
  result_next: Record<string, number>;
}

const asArray = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : []);
/** PHP отдаёт пустой ассоциативный массив как [] - нормализуем к объекту. */
const asMap = <T>(value: unknown): Record<string, T> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};

export class BitrixClient {
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly opts: Required<Pick<BitrixClientOptions, 'timeoutMs' | 'maxRetries' | 'baseBackoffMs' | 'maxBackoffMs'>>;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly logger?: Logger;

  constructor(options: BitrixClientOptions) {
    this.baseUrl = options.webhookUrl.endsWith('/') ? options.webhookUrl : `${options.webhookUrl}/`;
    this.sleep = options.sleep ?? defaultSleep;
    this.limiter = new RateLimiter(options.rateLimitRps ?? 2, this.sleep);
    this.fetchImpl = options.fetch ?? fetch;
    this.random = options.random ?? Math.random;
    this.logger = options.logger;
    this.opts = {
      timeoutMs: options.timeoutMs ?? 20_000,
      maxRetries: options.maxRetries ?? 5,
      baseBackoffMs: options.baseBackoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 15_000,
    };
  }

  /** Один вызов метода с лимитом частоты, таймаутом и ретраями на сеть, 5xx и QUERY_LIMIT_EXCEEDED. */
  async call<T = unknown>(method: string, params: BitrixParams = {}, signal?: AbortSignal): Promise<BitrixResponse<T>> {
    return withRetry((attempt) => this.request<T>(method, params, attempt, signal), {
      maxRetries: this.opts.maxRetries,
      baseDelayMs: this.opts.baseBackoffMs,
      maxDelayMs: this.opts.maxBackoffMs,
      isRetryable: (err) => err instanceof BitrixApiError && err.retryable,
      sleep: this.sleep,
      random: this.random,
      signal,
      onRetry: (err, attempt, delayMs) =>
        this.logger?.warn({ method, attempt, delayMs, err: (err as Error).message }, 'bitrix request failed, retrying'),
    });
  }

  private async request<T>(method: string, params: BitrixParams, attempt: number, signal?: AbortSignal): Promise<BitrixResponse<T>> {
    await this.limiter.acquire(signal);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${method}.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      if (isAbortError(err) || (err instanceof Error && err.name === 'TimeoutError')) {
        throw new BitrixApiError('TIMEOUT', `${method}: no response in ${this.opts.timeoutMs} ms`, null, true);
      }
      throw new BitrixApiError('NETWORK_ERROR', `${method}: ${(err as Error).message}`, null, true);
    }

    const text = await res.text();
    let body: Record<string, unknown> | null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body || typeof body.error === 'string') {
      const code = typeof body?.error === 'string' ? body.error : `HTTP_${res.status}`;
      const description = typeof body?.error_description === 'string' ? body.error_description : text.slice(0, 200);
      throw new BitrixApiError(code, `${method}: ${code} ${description}`.trim(), res.status, isRetryableCode(code, res.status));
    }
    this.logger?.debug({ method, attempt, status: res.status, next: body.next, total: body.total }, 'bitrix call');
    return {
      result: body.result as T,
      next: typeof body.next === 'number' ? body.next : undefined,
      total: typeof body.total === 'number' ? body.total : undefined,
    };
  }

  /** Классическая постраничность Bitrix: start=0, дальше по полю next, пока оно есть. */
  async *listPages<T>(method: string, params: BitrixParams, options: ListOptions<T> = {}): AsyncGenerator<BitrixPage<T>> {
    const extract = options.extract ?? asArray<T>;
    let start: number | undefined = 0;
    while (start !== undefined) {
      const res: BitrixResponse = await this.call(method, { ...params, start }, options.signal);
      yield { items: extract(res.result), total: res.total };
      start = res.next;
    }
  }

  /**
   * То же, что listPages, но после первой страницы (когда известен total) оставшиеся страницы
   * запрашиваются пачками через batch: до 50 страниц x 50 записей за один HTTP-запрос.
   * Без этого полный синк 100 тыс. записей при лимите 2 запроса/сек занимал бы ~17 минут.
   */
  async *list<T>(method: string, params: BitrixParams, options: ListOptions<T> = {}): AsyncGenerator<BitrixPage<T>> {
    const batchPages = Math.min(options.batchPages ?? 0, MAX_BATCH_COMMANDS);
    if (batchPages <= 1) {
      yield* this.listPages(method, params, options);
      return;
    }
    const extract = options.extract ?? asArray<T>;
    const first = await this.call(method, { ...params, start: 0 }, options.signal);
    yield { items: extract(first.result), total: first.total };

    let next = first.next;
    while (next !== undefined) {
      const total = first.total ?? next + BITRIX_PAGE_SIZE;
      const starts: number[] = [];
      for (let s = next; starts.length < batchPages && (starts.length === 0 || s < total); s += BITRIX_PAGE_SIZE) starts.push(s);
      const cmd = Object.fromEntries(starts.map((s, i) => [`p${i}`, `${method}?${qs.stringify({ ...params, start: s })}`]));
      const batch = await this.batch(cmd, options.signal);
      const items = starts.flatMap((_, i) => extract(batch.result[`p${i}`]));
      yield { items, total: first.total };
      next = batch.result_next[`p${starts.length - 1}`];
    }
  }

  /** batch с halt=1: при ошибке любой команды бросаем исключение, курсор синка не сдвигается. */
  async batch(cmd: Record<string, string>, signal?: AbortSignal): Promise<BatchResult> {
    const res = await this.call<Record<string, unknown>>('batch', { halt: 1, cmd }, signal);
    const raw = asMap<unknown>(res.result);
    const errors = asMap<{ error: string; error_description?: string }>(raw.result_error);
    const [key, failure] = Object.entries(errors)[0] ?? [];
    if (failure) {
      throw new BitrixApiError(
        failure.error,
        `batch command "${key}": ${failure.error} ${failure.error_description ?? ''}`.trim(),
        null,
        isRetryableCode(failure.error, null),
      );
    }
    return {
      result: asMap(raw.result),
      result_error: errors,
      result_total: asMap(raw.result_total),
      result_next: asMap(raw.result_next),
    };
  }

  /** Все записи справочного метода (маленькие объёмы). */
  async listAll<T>(method: string, params: BitrixParams = {}, options: ListOptions<T> = {}): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.listPages(method, params, options)) all.push(...page.items);
    return all;
  }
}
