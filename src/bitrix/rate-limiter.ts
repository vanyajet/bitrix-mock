import { sleep as defaultSleep, type Sleep } from './retry.js';

/**
 * Клиентский лимитер: выдерживает интервал между запросами (Bitrix24 разрешает ~2 запроса/сек на портал).
 * Интервал берётся с запасом 10%: сетевой джиттер не должен приводить к QUERY_LIMIT_EXCEEDED.
 */
export class RateLimiter {
  private nextAt = 0;
  private readonly intervalMs: number;

  constructor(
    rps: number,
    private readonly sleep: Sleep = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {
    this.intervalMs = Math.ceil((1000 / rps) * 1.1);
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    const now = this.now();
    const wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + this.intervalMs;
    if (wait > 0) await this.sleep(wait, signal);
  }
}
