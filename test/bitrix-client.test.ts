import qs from 'qs';
import { describe, expect, it } from 'vitest';
import { BitrixClient } from '../src/bitrix/client.js';
import { BitrixApiError } from '../src/bitrix/errors.js';

interface Call {
  method: string;
  body: Record<string, unknown>;
}

/** fetch-заглушка: отвечает handler'ом и запоминает вызовы. */
function fakeFetch(handler: (call: Call, index: number) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf('/') + 1).replace(/\.json$/, '');
    const call = { method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> };
    calls.push(call);
    const { status = 200, body } = handler(call, calls.length - 1);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => undefined;

describe('BitrixClient', () => {
  it('collects all pages by following "next"', async () => {
    const total = 120;
    const { impl, calls } = fakeFetch(({ body }) => {
      const start = Number(body.start);
      const ids = Array.from({ length: Math.min(50, total - start) }, (_, i) => ({ ID: String(start + i + 1) }));
      return { body: { result: ids, total, ...(start + 50 < total && { next: start + 50 }) } };
    });
    const client = new BitrixClient({ webhookUrl: 'https://portal.test/rest/1/token', fetch: impl, sleep: noSleep });

    const items = await client.listAll<{ ID: string }>('crm.lead.list', { filter: { '>DATE_MODIFY': '2026-01-01T00:00:00+03:00' } });

    expect(items).toHaveLength(total);
    expect(items.map((i) => Number(i.ID))).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(calls.map((c) => c.body.start)).toEqual([0, 50, 100]);
    // фильтр уходит в каждом запросе без изменений
    expect(calls.every((c) => (c.body.filter as Record<string, string>)['>DATE_MODIFY'] === '2026-01-01T00:00:00+03:00')).toBe(true);
  });

  it('fetches remaining pages via batch and keeps "+" in the cursor intact', async () => {
    const total = 180;
    const cursor = '2026-10-26T12:00:00+03:00';
    const page = (start: number) => Array.from({ length: Math.min(50, total - start) }, (_, i) => ({ ID: String(start + i + 1) }));
    const { impl, calls } = fakeFetch(({ method, body }) => {
      if (method !== 'batch') return { body: { result: page(0), total, next: 50 } };
      const cmd = body.cmd as Record<string, string>;
      const result: Record<string, unknown> = {};
      const next: Record<string, number> = {};
      for (const [key, command] of Object.entries(cmd)) {
        const params = qs.parse(command.slice(command.indexOf('?') + 1)) as { start: string; filter: Record<string, string> };
        expect(params.filter['>DATE_MODIFY']).toBe(cursor);
        const start = Number(params.start);
        result[key] = page(start);
        if (start + 50 < total) next[key] = start + 50;
      }
      return { body: { result: { result, result_error: [], result_total: {}, result_next: next } } };
    });
    const client = new BitrixClient({ webhookUrl: 'https://portal.test/rest/1/token', fetch: impl, sleep: noSleep });

    const ids: number[] = [];
    for await (const p of client.list<{ ID: string }>('crm.lead.list', { filter: { '>DATE_MODIFY': cursor } }, { batchPages: 50 })) {
      ids.push(...p.items.map((i) => Number(i.ID)));
    }

    expect(ids).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(calls.map((c) => c.method)).toEqual(['crm.lead.list', 'batch']);
  });

  it('retries QUERY_LIMIT_EXCEEDED with exponential backoff', async () => {
    const { impl, calls } = fakeFetch((_call, i) =>
      i < 2
        ? { status: 503, body: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' } }
        : { body: { result: [{ ID: '1' }], total: 1 } },
    );
    const sleeps: number[] = [];
    const client = new BitrixClient({
      webhookUrl: 'https://portal.test/rest/1/token',
      fetch: impl,
      rateLimitRps: 1000,
      baseBackoffMs: 1000,
      random: () => 0.5,
      sleep: async (ms) => {
        if (ms >= 100) sleeps.push(ms); // мелкие паузы - это клиентский rate limiter
      },
    });

    const res = await client.call<Array<{ ID: string }>>('crm.lead.list');

    expect(res.result).toEqual([{ ID: '1' }]);
    expect(calls).toHaveLength(3);
    // equal jitter: попытка n ждёт от base*2^n/2 до base*2^n, при random=0.5 - 3/4 от экспоненты
    expect(sleeps).toEqual([750, 1500]);
  });

  it('does not retry non-retryable errors and gives up after maxRetries', async () => {
    const auth = fakeFetch(() => ({ status: 401, body: { error: 'INVALID_CREDENTIALS', error_description: 'Invalid request credentials' } }));
    const client = new BitrixClient({ webhookUrl: 'https://portal.test/rest/1/bad', fetch: auth.impl, sleep: noSleep });
    await expect(client.call('crm.lead.list')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', retryable: false });
    expect(auth.calls).toHaveLength(1);

    const limited = fakeFetch(() => ({ status: 503, body: { error: 'QUERY_LIMIT_EXCEEDED' } }));
    const client2 = new BitrixClient({ webhookUrl: 'https://portal.test/rest/1/t', fetch: limited.impl, sleep: noSleep, maxRetries: 3 });
    await expect(client2.call('crm.lead.list')).rejects.toBeInstanceOf(BitrixApiError);
    expect(limited.calls).toHaveLength(4);
  });
});
