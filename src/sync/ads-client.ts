// Клиент рекламного API. В демо ходит в /mock/ads; в проде здесь были бы адаптеры
// Яндекс Директ (Reports API) и Google Ads (GAQL), приводящие ответ к тому же формату строк.

import { z } from 'zod';
import { VERTICALS, type Vertical } from '../config/domain.js';
import { withRetry } from '../bitrix/retry.js';
import type { AdSpendRow } from './repository.js';

const SpendResponse = z.object({
  data: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      vertical: z.enum(VERTICALS),
      channel: z.string(),
      campaign: z.string(),
      segment: z.string().nullable().optional(),
      impressions: z.number().int().nonnegative(),
      clicks: z.number().int().nonnegative(),
      spend: z.number().nonnegative(),
      currency: z.string().default('RUB'),
    }),
  ),
});

class AdsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AdsClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class AdsClient {
  constructor(private readonly opts: AdsClientOptions) {}

  async fetchSpend(vertical: Vertical, from: string, to: string, signal?: AbortSignal): Promise<AdSpendRow[]> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/spend?${new URLSearchParams({ from, to, vertical })}`;
    const body = await withRetry(
      async () => {
        const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 20_000);
        const res = await (this.opts.fetch ?? fetch)(url, {
          headers: { authorization: `Bearer ${this.opts.token}`, accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!res.ok) throw new AdsHttpError(res.status, `ads api ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return (await res.json()) as unknown;
      },
      {
        maxRetries: 4,
        baseDelayMs: 500,
        maxDelayMs: 8_000,
        signal,
        isRetryable: (err) => !(err instanceof AdsHttpError) || err.status >= 500 || err.status === 429,
      },
    );
    return SpendResponse.parse(body).data.map((r) => ({
      date: r.date,
      vertical: r.vertical,
      source: r.channel,
      campaign: r.campaign,
      segment: r.segment ?? null,
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.spend.toFixed(2),
      currency: r.currency,
    }));
  }
}
