/**
 * Кэш ответов API в памяти: TTL 60 с, ключ = эндпоинт + параметры, сбрасывается после синка.
 * Хранит промисы, поэтому одновременные одинаковые запросы считаются в БД один раз.
 */
export class ResponseCache {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) return { value: (await entry.value) as T, hit: true };
    if (this.ttlMs <= 0) return { value: await compute(), hit: false };

    const value = compute();
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    try {
      return { value: await value, hit: false };
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
