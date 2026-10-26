// SQL синка. Пачки пишутся через unnest(массивов) - один round-trip на пачку любого размера.
// Идемпотентность: ON CONFLICT ... DO UPDATE ... WHERE excluded.modified_at >= t.modified_at
// плюс IS DISTINCT FROM, чтобы повторный прогон не переписывал строки и честно показывал upserted = 0.

import type { Pool, PoolClient } from '../db/pool.js';
import type { DealRow, HistoryRow, LeadRow } from './mapping.js';

type Db = Pool | PoolClient;

export interface AdSpendRow {
  date: string;
  vertical: string;
  source: string;
  campaign: string;
  segment: string | null;
  impressions: number;
  clicks: number;
  spend: string;
  currency: string;
}

export interface UserRow {
  bitrixId: number;
  name: string;
  position: string | null;
  vertical: string | null;
  active: boolean;
}

export interface StageRow {
  entityType: 'lead' | 'deal';
  bitrixStageId: string;
  categoryId: number | null;
  name: string;
  semantics: string;
  sort: number;
  stage: string;
}

const col = <T, K extends keyof T>(rows: T[], key: K) => rows.map((r) => r[key]);

export async function upsertLeads(db: Db, rows: LeadRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO leads AS t (bitrix_id, title, vertical, segment, source, stage, bitrix_status_id, assigned_user_id,
                             amount, currency, created_at, modified_at, closed_at, is_won)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[],
                          $9::numeric[], $10::text[], $11::timestamptz[], $12::timestamptz[], $13::timestamptz[], $14::boolean[])
     ON CONFLICT (bitrix_id) DO UPDATE SET
       title = excluded.title, vertical = excluded.vertical, segment = excluded.segment, source = excluded.source,
       stage = excluded.stage, bitrix_status_id = excluded.bitrix_status_id, assigned_user_id = excluded.assigned_user_id,
       amount = excluded.amount, currency = excluded.currency, created_at = excluded.created_at,
       modified_at = excluded.modified_at, closed_at = excluded.closed_at, is_won = excluded.is_won, synced_at = now()
     WHERE excluded.modified_at >= t.modified_at
       AND (t.title, t.vertical, t.segment, t.source, t.stage, t.bitrix_status_id, t.assigned_user_id, t.amount,
            t.currency, t.created_at, t.modified_at, t.closed_at, t.is_won)
           IS DISTINCT FROM
           (excluded.title, excluded.vertical, excluded.segment, excluded.source, excluded.stage, excluded.bitrix_status_id,
            excluded.assigned_user_id, excluded.amount, excluded.currency, excluded.created_at, excluded.modified_at,
            excluded.closed_at, excluded.is_won)`,
    [
      col(rows, 'bitrixId'), col(rows, 'title'), col(rows, 'vertical'), col(rows, 'segment'), col(rows, 'source'),
      col(rows, 'stage'), col(rows, 'bitrixStatusId'), col(rows, 'assignedUserId'), col(rows, 'amount'),
      col(rows, 'currency'), col(rows, 'createdAt'), col(rows, 'modifiedAt'), col(rows, 'closedAt'), col(rows, 'isWon'),
    ],
  );
  return res.rowCount ?? 0;
}

export async function upsertDeals(db: Db, rows: DealRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO deals AS t (bitrix_id, lead_id, title, vertical, segment, source, stage, bitrix_stage_id, category_id,
                             assigned_user_id, amount, currency, created_at, modified_at, closed_at, is_won)
     SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
                          $9::int[], $10::bigint[], $11::numeric[], $12::text[], $13::timestamptz[], $14::timestamptz[],
                          $15::timestamptz[], $16::boolean[])
     ON CONFLICT (bitrix_id) DO UPDATE SET
       lead_id = excluded.lead_id, title = excluded.title, vertical = excluded.vertical, segment = excluded.segment,
       source = excluded.source, stage = excluded.stage, bitrix_stage_id = excluded.bitrix_stage_id,
       category_id = excluded.category_id, assigned_user_id = excluded.assigned_user_id, amount = excluded.amount,
       currency = excluded.currency, created_at = excluded.created_at, modified_at = excluded.modified_at,
       closed_at = excluded.closed_at, is_won = excluded.is_won, synced_at = now()
     WHERE excluded.modified_at >= t.modified_at
       AND (t.lead_id, t.title, t.vertical, t.segment, t.source, t.stage, t.bitrix_stage_id, t.category_id,
            t.assigned_user_id, t.amount, t.currency, t.created_at, t.modified_at, t.closed_at, t.is_won)
           IS DISTINCT FROM
           (excluded.lead_id, excluded.title, excluded.vertical, excluded.segment, excluded.source, excluded.stage,
            excluded.bitrix_stage_id, excluded.category_id, excluded.assigned_user_id, excluded.amount, excluded.currency,
            excluded.created_at, excluded.modified_at, excluded.closed_at, excluded.is_won)`,
    [
      col(rows, 'bitrixId'), col(rows, 'leadId'), col(rows, 'title'), col(rows, 'vertical'), col(rows, 'segment'),
      col(rows, 'source'), col(rows, 'stage'), col(rows, 'bitrixStageId'), col(rows, 'categoryId'),
      col(rows, 'assignedUserId'), col(rows, 'amount'), col(rows, 'currency'), col(rows, 'createdAt'),
      col(rows, 'modifiedAt'), col(rows, 'closedAt'), col(rows, 'isWon'),
    ],
  );
  return res.rowCount ?? 0;
}

/** История неизменяема: вставляем только новые записи. */
export async function insertHistory(db: Db, rows: HistoryRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO stage_history (entity_type, bitrix_id, owner_id, type_id, bitrix_stage_id, stage, category_id, created_at)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::smallint[], $5::text[], $6::text[], $7::int[], $8::timestamptz[])
     ON CONFLICT (entity_type, bitrix_id) DO NOTHING`,
    [
      col(rows, 'entityType'), col(rows, 'bitrixId'), col(rows, 'ownerId'), col(rows, 'typeId'),
      col(rows, 'bitrixStageId'), col(rows, 'stage'), col(rows, 'categoryId'), col(rows, 'createdAt'),
    ],
  );
  return res.rowCount ?? 0;
}

export async function upsertAdSpend(db: Db, rows: AdSpendRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO ad_spend AS t (date, vertical, source, campaign, segment, impressions, clicks, spend, currency)
     SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::numeric[], $9::text[])
     ON CONFLICT (vertical, source, campaign, date) DO UPDATE SET
       segment = excluded.segment, impressions = excluded.impressions, clicks = excluded.clicks,
       spend = excluded.spend, currency = excluded.currency, synced_at = now()
     WHERE (t.segment, t.impressions, t.clicks, t.spend, t.currency)
           IS DISTINCT FROM (excluded.segment, excluded.impressions, excluded.clicks, excluded.spend, excluded.currency)`,
    [
      col(rows, 'date'), col(rows, 'vertical'), col(rows, 'source'), col(rows, 'campaign'), col(rows, 'segment'),
      col(rows, 'impressions'), col(rows, 'clicks'), col(rows, 'spend'), col(rows, 'currency'),
    ],
  );
  return res.rowCount ?? 0;
}

export async function upsertUsers(db: Db, rows: UserRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO users AS t (bitrix_id, name, position, vertical, active)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::boolean[])
     ON CONFLICT (bitrix_id) DO UPDATE SET
       name = excluded.name, position = excluded.position, vertical = excluded.vertical, active = excluded.active, synced_at = now()
     WHERE (t.name, t.position, t.vertical, t.active) IS DISTINCT FROM (excluded.name, excluded.position, excluded.vertical, excluded.active)`,
    [col(rows, 'bitrixId'), col(rows, 'name'), col(rows, 'position'), col(rows, 'vertical'), col(rows, 'active')],
  );
  return res.rowCount ?? 0;
}

export async function upsertStages(db: Db, rows: StageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO stages AS t (entity_type, bitrix_stage_id, category_id, name, semantics, sort, stage)
     SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::int[], $7::text[])
     ON CONFLICT (entity_type, bitrix_stage_id) DO UPDATE SET
       category_id = excluded.category_id, name = excluded.name, semantics = excluded.semantics,
       sort = excluded.sort, stage = excluded.stage, synced_at = now()
     WHERE (t.category_id, t.name, t.semantics, t.sort, t.stage)
           IS DISTINCT FROM (excluded.category_id, excluded.name, excluded.semantics, excluded.sort, excluded.stage)`,
    [
      col(rows, 'entityType'), col(rows, 'bitrixStageId'), col(rows, 'categoryId'), col(rows, 'name'),
      col(rows, 'semantics'), col(rows, 'sort'), col(rows, 'stage'),
    ],
  );
  return res.rowCount ?? 0;
}

export async function upsertSources(db: Db, rows: Array<{ code: string; name: string }>): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO sources AS t (code, name)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (code) DO UPDATE SET name = excluded.name, synced_at = now()
     WHERE t.name IS DISTINCT FROM excluded.name`,
    [col(rows, 'code'), col(rows, 'name')],
  );
  return res.rowCount ?? 0;
}

export async function upsertCategories(db: Db, rows: Array<{ bitrixId: number; name: string; vertical: string | null }>): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO categories AS t (bitrix_id, name, vertical)
     SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
     ON CONFLICT (bitrix_id) DO UPDATE SET name = excluded.name, vertical = excluded.vertical, synced_at = now()
     WHERE (t.name, t.vertical) IS DISTINCT FROM (excluded.name, excluded.vertical)`,
    [col(rows, 'bitrixId'), col(rows, 'name'), col(rows, 'vertical')],
  );
  return res.rowCount ?? 0;
}

// --- Курсоры и журнал

export async function getCursor(db: Db, entity: string): Promise<Date | null> {
  const { rows } = await db.query<{ last_modified: Date | null }>('SELECT last_modified FROM sync_state WHERE entity = $1', [entity]);
  return rows[0]?.last_modified ?? null;
}

/** Курсор только растёт: GREATEST защищает от отката при повторной обработке старой пачки. */
export async function advanceCursor(db: Db, entity: string, value: Date): Promise<void> {
  await db.query(
    `INSERT INTO sync_state (entity, last_modified, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (entity) DO UPDATE
       SET last_modified = GREATEST(sync_state.last_modified, excluded.last_modified), updated_at = now()`,
    [entity, value],
  );
}

export async function startRunEntity(db: Db, runId: string, trigger: string, entity: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO sync_runs (run_id, trigger, entity, status) VALUES ($1, $2, $3, 'running') RETURNING id`,
    [runId, trigger, entity],
  );
  return rows[0]!.id;
}

export async function finishRunEntity(
  db: Db,
  id: number,
  result: { status: 'success' | 'failed' | 'aborted'; fetched: number; upserted: number; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE sync_runs SET status = $2, fetched = $3, upserted = $4, error = $5, finished_at = now() WHERE id = $1`,
    [id, result.status, result.fetched, result.upserted, result.error ?? null],
  );
}

/** Прогоны, оборванные падением процесса, помечаем как aborted, чтобы статус не висел в running. */
export async function closeStaleRuns(db: Db): Promise<number> {
  const res = await db.query(
    `UPDATE sync_runs SET status = 'aborted', finished_at = now(), error = coalesce(error, 'process stopped during sync')
     WHERE status = 'running'`,
  );
  return res.rowCount ?? 0;
}

export async function pruneRuns(db: Db, keepDays = 30): Promise<void> {
  await db.query(`DELETE FROM sync_runs WHERE started_at < now() - make_interval(days => $1)`, [keepDays]);
}
