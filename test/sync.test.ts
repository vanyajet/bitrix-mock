import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitrixClient } from '../src/bitrix/client.js';
import type { Pool } from '../src/db/pool.js';
import { MockStore } from '../src/mock/store.js';
import { AdsClient } from '../src/sync/ads-client.js';
import { SyncService, type SyncResult } from '../src/sync/worker.js';
import { createTestPool, resetDatabase, silentLogger, tableFingerprint } from './helpers/db.js';
import { ADS_TOKEN, startMockServer } from './helpers/mock-server.js';

const HOUR = 3_600_000;
const TABLES: Array<[string, string]> = [
  ['leads', 'bitrix_id'],
  ['deals', 'bitrix_id'],
  ['stage_history', 'entity_type, bitrix_id'],
  ['ad_spend', 'vertical, source, campaign, date'],
  ['users', 'bitrix_id'],
  ['stages', 'entity_type, bitrix_stage_id'],
];

const upserted = (r: SyncResult, entity: string) => r.entities.find((e) => e.entity === entity)?.upserted;
const fetched = (r: SyncResult, entity: string) => r.entities.find((e) => e.entity === entity)?.fetched;

async function fingerprints(pool: Pool) {
  return Object.fromEntries(await Promise.all(TABLES.map(async ([t, order]) => [t, await tableFingerprint(pool, t, order)] as const)));
}

describe('SyncService against mock Bitrix24', () => {
  // ~2.5 месяца жизни портала: несколько тысяч лидов, полный синк идёт через batch
  let now = Date.parse('2025-09-16T11:00:00+03:00');
  const store = new MockStore({ seed: 7, clock: () => now });
  let pool: Pool;
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let sync: SyncService;

  beforeAll(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
    server = await startMockServer(store);
    sync = new SyncService({
      pool,
      logger: silentLogger,
      bitrix: new BitrixClient({ webhookUrl: server.webhookUrl, rateLimitRps: 1000 }),
      ads: new AdsClient({ baseUrl: server.adsUrl, token: ADS_TOKEN }),
      config: {
        mapping: {
          segmentField: 'UF_CRM_SEGMENT',
          leadVerticalField: 'CATEGORY_ID',
          leadVerticals: { '1': 'dental', '2': 'metal' },
          categoryVerticals: { '1': 'dental', '2': 'metal' },
          departmentVerticals: { '10': 'dental', '20': 'metal' },
          stageOverrides: {},
        },
        timeZone: 'Europe/Moscow',
        cursorOverlapSec: 0,
        batchPages: 10,
        adsInitialDays: 30,
        adsRefreshDays: 3,
      },
      now: () => new Date(now),
    });
  });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it('initial full sync loads everything the portal has', async () => {
    const result = await sync.run('test');
    expect(result.status).toBe('success');

    const stats = store.stats();
    const { rows } = await pool.query<{ leads: number; deals: number; history: number }>(
      `SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM deals)::int AS deals,
              (SELECT count(*) FROM stage_history)::int AS history`,
    );
    expect(rows[0]).toEqual({ leads: stats.leads, deals: stats.deals, history: stats.leadHistory + stats.dealHistory });
    expect(stats.leads).toBeGreaterThan(2000);
  });

  it('repeated sync is idempotent: nothing is rewritten, row contents do not change', async () => {
    const before = await fingerprints(pool);

    const incremental = await sync.run('test');
    expect(incremental.status).toBe('success');
    for (const entity of ['leads', 'deals', 'lead_history', 'deal_history', 'ad_spend', 'dictionaries']) {
      expect(upserted(incremental, entity), entity).toBe(0);
    }

    // full=true перечитывает весь портал, но upsert всё равно ничего не меняет
    const full = await sync.run('test', { full: true });
    expect(full.status).toBe('success');
    expect(fetched(full, 'leads')).toBe(store.stats().leads);
    expect(full.entities.reduce((s, e) => s + e.upserted, 0)).toBe(0);

    expect(await fingerprints(pool)).toEqual(before);
  });

  it('incremental sync fetches only modified records and advances the cursor', async () => {
    const cursorOf = async (entity: string) =>
      (await pool.query<{ last_modified: Date }>('SELECT last_modified FROM sync_state WHERE entity = $1', [entity])).rows[0]!.last_modified;
    const cursorBefore = await cursorOf('leads');
    const untouched = await pool.query<{ bitrix_id: number; synced_at: Date }>(
      'SELECT bitrix_id, synced_at FROM leads ORDER BY modified_at LIMIT 1',
    );

    now += 26 * HOUR; // сутки работы портала: новые лиды и переходы по стадиям
    const changed = store
      .snapshot()
      .leads()
      .filter((l) => (l.DATE_MODIFY as number) > cursorBefore.getTime());
    expect(changed.length).toBeGreaterThan(50); // больше страницы -> догрузка через batch с курсором в фильтре

    const result = await sync.run('test');
    expect(result.status).toBe('success');
    expect(fetched(result, 'leads')).toBe(changed.length);
    expect(upserted(result, 'leads')).toBe(changed.length);

    const maxModified = Math.max(...changed.map((l) => l.DATE_MODIFY as number));
    expect((await cursorOf('leads')).getTime()).toBe(maxModified);

    const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM leads');
    expect(rows[0]!.count).toBe(store.stats().leads);
    const after = await pool.query<{ synced_at: Date }>('SELECT synced_at FROM leads WHERE bitrix_id = $1', [untouched.rows[0]!.bitrix_id]);
    expect(after.rows[0]!.synced_at).toEqual(untouched.rows[0]!.synced_at);
  });

  it('refuses a parallel run while another one is in progress', async () => {
    const first = sync.run('test');
    await expect(sync.run('test')).rejects.toThrow('already running');
    expect((await first).status).toBe('success');
  });
});
