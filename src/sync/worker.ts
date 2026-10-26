// Sync-воркер: Bitrix24 (+ рекламный кабинет) -> PostgreSQL.
//
// - инкрементально по курсору (DATE_MODIFY для лидов/сделок, CREATED_TIME для истории стадий);
// - первый запуск = полный синк постранично, каждая пачка коммитится сразу (память не растёт);
// - курсор сдвигается в той же транзакции, что и запись пачки, т.е. только после успешного коммита;
// - параллельные запуски (cron + ручной, несколько инстансов) исключает pg_try_advisory_lock;
// - SIGTERM: текущая пачка дописывается, дальше прогон помечается aborted.

import { randomUUID } from 'node:crypto';
import { VERTICALS, type Vertical } from '../config/domain.js';
import { toBitrixDate } from '../bitrix/dates.js';
import type { BitrixClient } from '../bitrix/client.js';
import { isAbortError } from '../bitrix/errors.js';
import { LOCK_SYNC } from '../db/locks.js';
import { withTransaction, type Pool } from '../db/pool.js';
import type { Logger } from '../logger.js';
import type { AdsClient } from './ads-client.js';
import {
  canonicalStage,
  dedupeLatest,
  mapDeal,
  mapHistory,
  mapLead,
  parseSemantics,
  StatusRecord,
  UserRecord,
  type Dictionaries,
  type HistoryRow,
  type MapResult,
  type MappingConfig,
} from './mapping.js';
import * as repo from './repository.js';

export type SyncTrigger = 'startup' | 'cron' | 'manual' | 'test';
export type EntityStatus = 'success' | 'failed' | 'aborted';

export interface EntityResult {
  entity: string;
  status: EntityStatus;
  fetched: number;
  upserted: number;
  skipped: number;
  error?: string;
}

export interface SyncResult {
  runId: string;
  trigger: SyncTrigger;
  status: EntityStatus | 'skipped';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  entities: EntityResult[];
  error?: string;
}

export interface SyncConfig {
  mapping: MappingConfig;
  timeZone: string;
  cursorOverlapSec: number;
  batchPages: number;
  /** Глубина первой загрузки расходов на рекламу и перезапрашиваемое окно (кабинеты дописывают последние дни). */
  adsInitialDays: number;
  adsRefreshDays: number;
}

export interface SyncServiceDeps {
  pool: Pool;
  logger: Logger;
  bitrix: BitrixClient;
  ads: AdsClient | null;
  config: SyncConfig;
  /** Вызывается после полностью успешного прогона (REFRESH MATERIALIZED VIEW, сброс кэша API). */
  afterSuccess?: (result: SyncResult) => Promise<void>;
  now?: () => Date;
}

interface StepContext {
  runId: string;
  trigger: SyncTrigger;
  full: boolean;
  signal: AbortSignal;
  dict: Dictionaries;
}

interface StepOutcome {
  fetched: number;
  upserted: number;
  skipped: number;
}

const LEAD_FIELDS = ['ID', 'TITLE', 'STATUS_ID', 'STATUS_SEMANTIC_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'DATE_MODIFY', 'DATE_CLOSED', 'OPPORTUNITY', 'CURRENCY_ID'];
const DEAL_FIELDS = ['ID', 'TITLE', 'LEAD_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'CLOSED', 'CLOSEDATE', 'DATE_CREATE', 'DATE_MODIFY'];
const DAY_MS = 86_400_000;

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('sync is already running');
  }
}

export class SyncService {
  private current: Promise<SyncResult> | null = null;
  private runId: string | null = null;
  private abortController: AbortController | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: SyncServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get isRunning(): boolean {
    return this.current !== null;
  }

  get currentRunId(): string | null {
    return this.runId;
  }

  /** Запуск прогона. Если прогон уже идёт в этом процессе - SyncAlreadyRunningError. */
  run(trigger: SyncTrigger, opts: { full?: boolean } = {}): Promise<SyncResult> {
    if (this.current) return Promise.reject(new SyncAlreadyRunningError());
    this.abortController = new AbortController();
    this.runId = randomUUID();
    this.current = this.execute(this.runId, trigger, opts.full ?? false, this.abortController.signal).finally(() => {
      this.current = null;
      this.runId = null;
      this.abortController = null;
    });
    return this.current;
  }

  /** Корректная остановка: прерывает прогон между пачками и ждёт его завершения. */
  async stop(): Promise<void> {
    this.abortController?.abort(new DOMException('sync stopped', 'AbortError'));
    await this.current?.catch(() => undefined);
  }

  private async execute(runId: string, trigger: SyncTrigger, full: boolean, signal: AbortSignal): Promise<SyncResult> {
    const { pool, logger } = this.deps;
    const started = Date.now();
    const lockClient = await pool.connect();
    const entities: EntityResult[] = [];
    let status: SyncResult['status'];
    let error: string | undefined;

    try {
      const { rows } = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_SYNC]);
      if (!rows[0]?.locked) {
        logger.info({ trigger }, 'sync skipped: another instance holds the lock');
        return this.result(runId, trigger, 'skipped', started, entities, 'another sync is in progress');
      }
      try {
        const stale = await repo.closeStaleRuns(pool);
        if (stale > 0) logger.warn({ stale }, 'closed sync runs left by a crashed process');
        logger.info({ runId, trigger, full }, 'sync started');

        const dict = await this.step(entities, runId, trigger, 'dictionaries', signal, async () => this.syncDictionaries());
        if (dict) {
          const ctx: StepContext = { runId, trigger, full, signal, dict: dict.dict };
          const steps: Array<[string, () => Promise<StepOutcome>]> = [
            ['leads', () => this.syncLeads(ctx)],
            ['deals', () => this.syncDeals(ctx)],
            ['lead_history', () => this.syncHistory(ctx, 'lead')],
            ['deal_history', () => this.syncHistory(ctx, 'deal')],
          ];
          if (this.deps.ads) steps.push(['ad_spend', () => this.syncAdSpend(ctx)]);
          for (const [entity, fn] of steps) {
            if (!(await this.step(entities, runId, trigger, entity, signal, fn))) break;
          }
        }

        const failed = entities.find((e) => e.status !== 'success');
        status = failed?.status ?? 'success';
        error = failed?.error;
        await repo.pruneRuns(pool);
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_SYNC]).catch(() => undefined);
      }
    } catch (err) {
      status = 'failed';
      error = (err as Error).message;
      logger.error({ err, runId }, 'sync crashed');
    } finally {
      lockClient.release();
    }

    const result = this.result(runId, trigger, status, started, entities, error);
    logger.info(
      { runId, status, durationMs: result.durationMs, upserted: entities.reduce((s, e) => s + e.upserted, 0) },
      'sync finished',
    );
    if (status === 'success') {
      try {
        await this.deps.afterSuccess?.(result);
      } catch (err) {
        logger.error({ err }, 'post-sync hook failed');
      }
    }
    return result;
  }

  private result(runId: string, trigger: SyncTrigger, status: SyncResult['status'], started: number, entities: EntityResult[], error?: string): SyncResult {
    const finished = Date.now();
    return {
      runId,
      trigger,
      status,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      entities,
      ...(error && { error }),
    };
  }

  /** Обёртка шага: строка в sync_runs, подсчёт, перехват ошибок. Возвращает null, если шаг не удался. */
  private async step<T extends StepOutcome>(
    entities: EntityResult[],
    runId: string,
    trigger: SyncTrigger,
    entity: string,
    signal: AbortSignal,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const { pool, logger } = this.deps;
    const id = await repo.startRunEntity(pool, runId, trigger, entity);
    const started = Date.now();
    try {
      if (signal.aborted) throw signal.reason;
      const outcome = await fn();
      await repo.finishRunEntity(pool, id, { status: 'success', fetched: outcome.fetched, upserted: outcome.upserted });
      entities.push({ entity, status: 'success', fetched: outcome.fetched, upserted: outcome.upserted, skipped: outcome.skipped });
      logger.info({ entity, fetched: outcome.fetched, upserted: outcome.upserted, skipped: outcome.skipped, ms: Date.now() - started }, 'sync entity done');
      return outcome;
    } catch (err) {
      const aborted = isAbortError(err) || signal.aborted;
      const message = aborted ? 'aborted by shutdown' : (err as Error).message;
      const partial = (err as { outcome?: StepOutcome }).outcome ?? { fetched: 0, upserted: 0, skipped: 0 };
      await repo.finishRunEntity(pool, id, { status: aborted ? 'aborted' : 'failed', ...partial, error: message });
      entities.push({ entity, status: aborted ? 'aborted' : 'failed', ...partial, error: message });
      if (aborted) logger.warn({ entity }, 'sync entity aborted');
      else logger.error({ entity, err }, 'sync entity failed');
      return null;
    }
  }

  // --- Справочники: сотрудники, статусы/стадии, источники, воронки, значения списочных полей

  private async syncDictionaries(): Promise<StepOutcome & { dict: Dictionaries }> {
    const { bitrix, pool, config } = this.deps;
    const cfg = config.mapping;

    const users = (await bitrix.listAll<unknown>('user.get', { ACTIVE: true }))
      .map((u) => UserRecord.safeParse(u))
      .flatMap((r) => (r.success ? [r.data] : []));
    const userVerticals = new Map<number, Vertical>();
    const userRows = users.map((u) => {
      const departments = Array.isArray(u.UF_DEPARTMENT) ? u.UF_DEPARTMENT : u.UF_DEPARTMENT !== undefined ? [u.UF_DEPARTMENT] : [];
      const vertical = departments.map((d) => cfg.departmentVerticals[String(d)]).find(Boolean) ?? null;
      if (vertical) userVerticals.set(u.ID, vertical);
      return {
        bitrixId: u.ID,
        name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || `Сотрудник #${u.ID}`,
        position: u.WORK_POSITION,
        vertical,
        active: u.ACTIVE === undefined || u.ACTIVE === true || u.ACTIVE === 'Y',
      };
    });

    const statuses = (await bitrix.listAll<unknown>('crm.status.list', { order: { SORT: 'ASC' } }))
      .map((s) => StatusRecord.safeParse(s))
      .flatMap((r) => (r.success ? [r.data] : []));
    const leadStatuses: Dictionaries['leadStatuses'] = new Map();
    const dealStages: Dictionaries['dealStages'] = new Map();
    const stageRows: repo.StageRow[] = [];
    const sourceRows: Array<{ code: string; name: string }> = [];
    for (const s of statuses) {
      if (s.ENTITY_ID === 'SOURCE') {
        sourceRows.push({ code: s.STATUS_ID, name: s.NAME });
        continue;
      }
      const entity = s.ENTITY_ID === 'STATUS' ? 'lead' : s.ENTITY_ID.startsWith('DEAL_STAGE') ? 'deal' : null;
      if (!entity) continue;
      const semantics = parseSemantics(s.SEMANTICS, s.EXTRA?.SEMANTICS);
      const stage = canonicalStage(entity, s.STATUS_ID, semantics, cfg.stageOverrides);
      (entity === 'lead' ? leadStatuses : dealStages).set(s.STATUS_ID, { semantics, stage });
      stageRows.push({ entityType: entity, bitrixStageId: s.STATUS_ID, categoryId: s.CATEGORY_ID, name: s.NAME, semantics, sort: s.SORT, stage });
    }

    const categories = (await bitrix.call<{ categories?: Array<{ id: number; name: string }> }>('crm.category.list', { entityTypeId: 2 })).result
      .categories ?? [];
    const categoryRows = categories.map((c) => ({ bitrixId: Number(c.id), name: c.name, vertical: cfg.categoryVerticals[String(c.id)] ?? null }));

    const enumLabels = async (method: string) => {
      const fields = await bitrix.listAll<{ FIELD_NAME?: string; LIST?: Array<{ ID: string | number; VALUE: string }> }>(method, {
        filter: { FIELD_NAME: cfg.segmentField },
      });
      const field = fields.find((f) => f.FIELD_NAME === cfg.segmentField);
      return new Map((field?.LIST ?? []).map((item) => [String(item.ID), item.VALUE]));
    };
    const leadSegments = await enumLabels('crm.lead.userfield.list');
    const dealSegments = await enumLabels('crm.deal.userfield.list');

    let upserted = 0;
    await withTransaction(pool, async (db) => {
      upserted += await repo.upsertUsers(db, userRows);
      upserted += await repo.upsertStages(db, stageRows);
      upserted += await repo.upsertSources(db, sourceRows);
      upserted += await repo.upsertCategories(db, categoryRows);
    });

    return {
      fetched: users.length + statuses.length + categories.length,
      upserted,
      skipped: 0,
      dict: { leadStatuses, dealStages, leadSegments, dealSegments, userVerticals },
    };
  }

  // --- Лиды и сделки: инкрементально по DATE_MODIFY

  private incrementalFilter(field: string, cursor: Date | null, full: boolean): Record<string, string> {
    if (!cursor || full) return {};
    const since = new Date(cursor.getTime() - this.deps.config.cursorOverlapSec * 1000);
    return { [`>${field}`]: toBitrixDate(since, this.deps.config.timeZone) };
  }

  private async syncByModified<R extends { bitrixId: number; modifiedAt: Date }>(
    ctx: StepContext,
    entity: 'leads' | 'deals',
    method: string,
    select: string[],
    map: (record: unknown) => MapResult<R>,
    write: (db: Parameters<typeof repo.upsertLeads>[0], rows: R[]) => Promise<number>,
  ): Promise<StepOutcome> {
    const { pool, bitrix, config, logger } = this.deps;
    const cursor = await repo.getCursor(pool, entity);
    const outcome: StepOutcome = { fetched: 0, upserted: 0, skipped: 0 };
    const pages = bitrix.list<Record<string, unknown>>(
      method,
      { filter: this.incrementalFilter('DATE_MODIFY', cursor, ctx.full), order: { DATE_MODIFY: 'ASC', ID: 'ASC' }, select },
      { batchPages: config.batchPages, signal: ctx.signal },
    );
    try {
      for await (const page of pages) {
        if (page.items.length === 0) continue;
        outcome.fetched += page.items.length;
        const rows: R[] = [];
        let maxModified: Date | null = null;
        for (const item of page.items) {
          const modified = new Date(String(item.DATE_MODIFY));
          if (!Number.isNaN(modified.getTime()) && (!maxModified || modified > maxModified)) maxModified = modified;
          const mapped = map(item);
          if (mapped.ok) rows.push(mapped.row);
          else {
            outcome.skipped++;
            logger.debug({ entity, reason: mapped.reason }, 'record skipped');
          }
        }
        // запись пачки и сдвиг курсора атомарны
        outcome.upserted += await withTransaction(pool, async (db) => {
          const n = await write(db, dedupeLatest(rows));
          if (maxModified) await repo.advanceCursor(db, entity, maxModified);
          return n;
        });
        if (ctx.signal.aborted) throw ctx.signal.reason;
      }
    } catch (err) {
      throw Object.assign(err as Error, { outcome });
    }
    if (outcome.skipped > 0) logger.warn({ entity, skipped: outcome.skipped }, 'some records were skipped (see mapping config)');
    return outcome;
  }

  private syncLeads(ctx: StepContext): Promise<StepOutcome> {
    const cfg = this.deps.config.mapping;
    const select = [...LEAD_FIELDS, cfg.segmentField, ...(cfg.leadVerticalField ? [cfg.leadVerticalField] : [])];
    return this.syncByModified(ctx, 'leads', 'crm.lead.list', select, (r) => mapLead(r, ctx.dict, cfg), repo.upsertLeads);
  }

  private syncDeals(ctx: StepContext): Promise<StepOutcome> {
    const cfg = this.deps.config.mapping;
    return this.syncByModified(ctx, 'deals', 'crm.deal.list', [...DEAL_FIELDS, cfg.segmentField], (r) => mapDeal(r, ctx.dict, cfg), repo.upsertDeals);
  }

  // --- История стадий: записи неизменяемы, курсор по CREATED_TIME

  private async syncHistory(ctx: StepContext, entityType: 'lead' | 'deal'): Promise<StepOutcome> {
    const { pool, bitrix, config } = this.deps;
    const entity = `${entityType}_history`;
    const cursor = await repo.getCursor(pool, entity);
    const outcome: StepOutcome = { fetched: 0, upserted: 0, skipped: 0 };
    const pages = bitrix.list<Record<string, unknown>>(
      'crm.stagehistory.list',
      {
        entityTypeId: entityType === 'lead' ? 1 : 2,
        filter: this.incrementalFilter('CREATED_TIME', cursor, ctx.full),
        order: { CREATED_TIME: 'ASC', ID: 'ASC' },
      },
      { batchPages: config.batchPages, signal: ctx.signal, extract: (r) => ((r as { items?: Array<Record<string, unknown>> })?.items ?? []) },
    );
    try {
      for await (const page of pages) {
        if (page.items.length === 0) continue;
        outcome.fetched += page.items.length;
        const rows: HistoryRow[] = [];
        let maxCreated: Date | null = null;
        for (const item of page.items) {
          const mapped = mapHistory(entityType, item, ctx.dict, config.mapping);
          if (!mapped.ok) {
            outcome.skipped++;
            continue;
          }
          rows.push(mapped.row);
          if (!maxCreated || mapped.row.createdAt > maxCreated) maxCreated = mapped.row.createdAt;
        }
        outcome.upserted += await withTransaction(pool, async (db) => {
          const n = await repo.insertHistory(db, rows);
          if (maxCreated) await repo.advanceCursor(db, entity, maxCreated);
          return n;
        });
        if (ctx.signal.aborted) throw ctx.signal.reason;
      }
    } catch (err) {
      throw Object.assign(err as Error, { outcome });
    }
    return outcome;
  }

  // --- Расходы на рекламу: окнами по 31 день, последние дни перезапрашиваются

  private async syncAdSpend(ctx: StepContext): Promise<StepOutcome> {
    const { pool, config } = this.deps;
    const ads = this.deps.ads!;
    const cursor = await repo.getCursor(pool, 'ad_spend');
    const today = this.localDate(this.now());
    const fromDate =
      cursor && !ctx.full
        ? this.addDays(this.localDate(cursor), -config.adsRefreshDays)
        : this.addDays(today, -config.adsInitialDays);
    const outcome: StepOutcome = { fetched: 0, upserted: 0, skipped: 0 };
    try {
      for (let from = fromDate; from <= today; from = this.addDays(from, 31)) {
        const to = this.minDate(this.addDays(from, 30), today);
        const rows = (await Promise.all(VERTICALS.map((v) => ads.fetchSpend(v, from, to, ctx.signal)))).flat();
        outcome.fetched += rows.length;
        outcome.upserted += await withTransaction(pool, async (db) => {
          const n = await repo.upsertAdSpend(db, rows);
          await repo.advanceCursor(db, 'ad_spend', new Date(`${to}T00:00:00Z`));
          return n;
        });
        if (ctx.signal.aborted) throw ctx.signal.reason;
      }
    } catch (err) {
      throw Object.assign(err as Error, { outcome });
    }
    return outcome;
  }

  private localDate(date: Date): string {
    return toBitrixDate(date, this.deps.config.timeZone).slice(0, 10);
  }

  private addDays(isoDate: string, days: number): string {
    return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  }

  private minDate(a: string, b: string): string {
    return a < b ? a : b;
  }
}
