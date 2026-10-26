// Маппинг записей Bitrix24 на нормализованную модель БД. Чистые функции без I/O - легко тестируются.

import { z } from 'zod';
import { STAGES, type Semantics, type Stage, type Vertical } from '../config/domain.js';

export interface MappingConfig {
  segmentField: string;
  leadVerticalField: string;
  leadVerticals: Record<string, Vertical>;
  categoryVerticals: Record<string, Vertical>;
  departmentVerticals: Record<string, Vertical>;
  defaultVertical?: Vertical;
  stageOverrides: Record<string, Stage>;
}

/** Справочники портала, загруженные в начале прогона синка. */
export interface Dictionaries {
  leadStatuses: Map<string, { semantics: Semantics; stage: Stage }>;
  dealStages: Map<string, { semantics: Semantics; stage: Stage }>;
  leadSegments: Map<string, string>;
  dealSegments: Map<string, string>;
  userVerticals: Map<number, Vertical>;
}

// --- Входные записи: Bitrix отдаёт числа строками, пустые даты как "" или null

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);
const bitrixDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date').transform((s) => new Date(s));
const optionalDate = z.preprocess(emptyToNull, bitrixDate.nullable());
const optionalInt = z.preprocess(emptyToNull, z.coerce.number().int().nullable());
const optionalText = z.preprocess(emptyToNull, z.coerce.string().nullable());
/** Деньги остаются строкой "15000.00" до numeric(14,2) в Postgres - никакого float по дороге. */
const money = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? '0' : v),
  z.union([z.string(), z.number()]).transform((v) => String(v)).refine((s) => /^-?\d+(\.\d+)?$/.test(s), 'invalid money'),
);

export const LeadRecord = z
  .object({
    ID: z.coerce.number().int().positive(),
    TITLE: optionalText,
    STATUS_ID: z.string().min(1),
    STATUS_SEMANTIC_ID: optionalText,
    SOURCE_ID: optionalText,
    ASSIGNED_BY_ID: optionalInt,
    DATE_CREATE: bitrixDate,
    DATE_MODIFY: bitrixDate,
    DATE_CLOSED: optionalDate,
    OPPORTUNITY: money,
    CURRENCY_ID: optionalText,
  })
  .loose();

export const DealRecord = z
  .object({
    ID: z.coerce.number().int().positive(),
    TITLE: optionalText,
    LEAD_ID: optionalInt,
    STAGE_ID: z.string().min(1),
    STAGE_SEMANTIC_ID: optionalText,
    CATEGORY_ID: optionalInt,
    SOURCE_ID: optionalText,
    ASSIGNED_BY_ID: optionalInt,
    OPPORTUNITY: money,
    CURRENCY_ID: optionalText,
    CLOSED: optionalText,
    CLOSEDATE: optionalDate,
    DATE_CREATE: bitrixDate,
    DATE_MODIFY: bitrixDate,
  })
  .loose();

export const HistoryRecord = z
  .object({
    ID: z.coerce.number().int().positive(),
    TYPE_ID: z.coerce.number().int(),
    OWNER_ID: z.coerce.number().int().positive(),
    CREATED_TIME: bitrixDate,
    STATUS_ID: optionalText,
    STAGE_ID: optionalText,
    STATUS_SEMANTIC_ID: optionalText,
    STAGE_SEMANTIC_ID: optionalText,
    CATEGORY_ID: optionalInt,
  })
  .loose();

export const UserRecord = z
  .object({
    ID: z.coerce.number().int().positive(),
    NAME: optionalText,
    LAST_NAME: optionalText,
    WORK_POSITION: optionalText,
    ACTIVE: z.union([z.boolean(), z.string()]).optional(),
    UF_DEPARTMENT: z.union([z.array(z.coerce.number()), z.coerce.number()]).optional(),
  })
  .loose();

export const StatusRecord = z
  .object({
    ENTITY_ID: z.string(),
    STATUS_ID: z.string(),
    NAME: z.string(),
    SORT: z.coerce.number().default(0),
    CATEGORY_ID: optionalInt,
    SEMANTICS: optionalText,
    EXTRA: z.object({ SEMANTICS: z.string().optional() }).loose().optional(),
  })
  .loose();

// --- Строки БД

export interface LeadRow {
  bitrixId: number;
  title: string | null;
  vertical: Vertical;
  segment: string | null;
  source: string | null;
  stage: Stage;
  bitrixStatusId: string;
  assignedUserId: number | null;
  amount: string;
  currency: string;
  createdAt: Date;
  modifiedAt: Date;
  closedAt: Date | null;
  isWon: boolean;
}

export interface DealRow extends Omit<LeadRow, 'bitrixStatusId'> {
  leadId: number | null;
  bitrixStageId: string;
  categoryId: number | null;
}

export interface HistoryRow {
  entityType: 'lead' | 'deal';
  bitrixId: number;
  ownerId: number;
  typeId: number;
  bitrixStageId: string;
  stage: Stage;
  categoryId: number | null;
  createdAt: Date;
}

// --- Семантика и стадии

const SEMANTIC_CODES: Record<string, Semantics> = { S: 'success', F: 'failure', P: 'process' };

export function parseSemantics(code: string | null | undefined, extra?: string): Semantics {
  if (extra === 'success' || extra === 'failure' || extra === 'process') return extra;
  return SEMANTIC_CODES[code ?? 'P'] ?? 'process';
}

const LEAD_STAGE_BY_CODE: Record<string, Stage> = {
  NEW: 'NEW',
  IN_PROCESS: 'IN_PROGRESS',
  PROCESSED: 'QUALIFIED',
  CONVERTED: 'QUALIFIED',
  JUNK: 'LOST',
};

const DEAL_STAGE_BY_CODE: Record<string, Stage> = {
  NEW: 'QUALIFIED',
  PREPARATION: 'MEETING',
  PREPAYMENT_INVOICE: 'MEETING',
  EXECUTING: 'MEETING',
  FINAL_INVOICE: 'MEETING',
  WON: 'WON',
  LOSE: 'LOST',
  APOLOGY: 'LOST',
};

/**
 * Каноническая стадия для статуса лида / стадии сделки:
 * 1) явный override из BITRIX_STAGE_MAP (по полному ID или без префикса воронки C1:),
 * 2) стандартные коды Bitrix24, 3) фолбэк по семантике (успех/провал/в работе).
 */
export function canonicalStage(entity: 'lead' | 'deal', statusId: string, semantics: Semantics, overrides: Record<string, Stage> = {}): Stage {
  const code = statusId.replace(/^C\d+:/, '');
  const override = overrides[statusId] ?? overrides[code];
  if (override) return override;
  if (entity === 'lead') {
    if (/NO_?ANSWER|NEDOZVON/i.test(code)) return 'NO_ANSWER';
    return LEAD_STAGE_BY_CODE[code] ?? (semantics === 'success' ? 'QUALIFIED' : semantics === 'failure' ? 'LOST' : 'IN_PROGRESS');
  }
  return DEAL_STAGE_BY_CODE[code] ?? (semantics === 'success' ? 'WON' : semantics === 'failure' ? 'LOST' : 'MEETING');
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

// --- Маппинг записей

function resolveVertical(
  explicit: Vertical | undefined,
  assignedUserId: number | null,
  dict: Dictionaries,
  cfg: MappingConfig,
): Vertical | null {
  return explicit ?? (assignedUserId !== null ? dict.userVerticals.get(assignedUserId) : undefined) ?? cfg.defaultVertical ?? null;
}

function resolveSegment(raw: unknown, enumLabels: Map<string, string>): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === false) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === null || value === undefined || value === '') return null;
  const key = String(value);
  return enumLabels.get(key) ?? key;
}

export type MapResult<T> = { ok: true; row: T } | { ok: false; reason: string };

export function mapLead(record: unknown, dict: Dictionaries, cfg: MappingConfig): MapResult<LeadRow> {
  const parsed = LeadRecord.safeParse(record);
  if (!parsed.success) return { ok: false, reason: `invalid lead: ${parsed.error.issues[0]?.message}` };
  const r = parsed.data;
  const raw = r as Record<string, unknown>;
  const verticalKey = cfg.leadVerticalField ? raw[cfg.leadVerticalField] : undefined;
  const vertical = resolveVertical(
    verticalKey !== undefined && verticalKey !== null ? cfg.leadVerticals[String(verticalKey)] : undefined,
    r.ASSIGNED_BY_ID,
    dict,
    cfg,
  );
  if (!vertical) return { ok: false, reason: `lead ${r.ID}: vertical is not mapped` };
  const known = dict.leadStatuses.get(r.STATUS_ID);
  const semantics = known?.semantics ?? parseSemantics(r.STATUS_SEMANTIC_ID);
  const stage = known?.stage ?? canonicalStage('lead', r.STATUS_ID, semantics, cfg.stageOverrides);
  return {
    ok: true,
    row: {
      bitrixId: r.ID,
      title: r.TITLE,
      vertical,
      segment: resolveSegment(raw[cfg.segmentField], dict.leadSegments),
      source: r.SOURCE_ID,
      stage,
      bitrixStatusId: r.STATUS_ID,
      assignedUserId: r.ASSIGNED_BY_ID,
      amount: r.OPPORTUNITY,
      currency: r.CURRENCY_ID ?? 'RUB',
      createdAt: r.DATE_CREATE,
      modifiedAt: r.DATE_MODIFY,
      closedAt: semantics === 'process' ? null : (r.DATE_CLOSED ?? r.DATE_MODIFY),
      isWon: semantics === 'success',
    },
  };
}

export function mapDeal(record: unknown, dict: Dictionaries, cfg: MappingConfig): MapResult<DealRow> {
  const parsed = DealRecord.safeParse(record);
  if (!parsed.success) return { ok: false, reason: `invalid deal: ${parsed.error.issues[0]?.message}` };
  const r = parsed.data;
  const raw = r as Record<string, unknown>;
  const vertical = resolveVertical(
    r.CATEGORY_ID !== null ? cfg.categoryVerticals[String(r.CATEGORY_ID)] : undefined,
    r.ASSIGNED_BY_ID,
    dict,
    cfg,
  );
  if (!vertical) return { ok: false, reason: `deal ${r.ID}: vertical is not mapped` };
  const known = dict.dealStages.get(r.STAGE_ID);
  const semantics = known?.semantics ?? parseSemantics(r.STAGE_SEMANTIC_ID);
  const stage = known?.stage ?? canonicalStage('deal', r.STAGE_ID, semantics, cfg.stageOverrides);
  const closed = r.CLOSED === 'Y' || semantics !== 'process';
  return {
    ok: true,
    row: {
      bitrixId: r.ID,
      leadId: r.LEAD_ID && r.LEAD_ID > 0 ? r.LEAD_ID : null,
      title: r.TITLE,
      vertical,
      segment: resolveSegment(raw[cfg.segmentField], dict.dealSegments),
      source: r.SOURCE_ID,
      stage,
      bitrixStageId: r.STAGE_ID,
      categoryId: r.CATEGORY_ID,
      assignedUserId: r.ASSIGNED_BY_ID,
      amount: r.OPPORTUNITY,
      currency: r.CURRENCY_ID ?? 'RUB',
      createdAt: r.DATE_CREATE,
      modifiedAt: r.DATE_MODIFY,
      closedAt: closed ? (r.CLOSEDATE ?? r.DATE_MODIFY) : null,
      isWon: semantics === 'success',
    },
  };
}

export function mapHistory(entity: 'lead' | 'deal', record: unknown, dict: Dictionaries, cfg: MappingConfig): MapResult<HistoryRow> {
  const parsed = HistoryRecord.safeParse(record);
  if (!parsed.success) return { ok: false, reason: `invalid history: ${parsed.error.issues[0]?.message}` };
  const r = parsed.data;
  const stageId = (entity === 'lead' ? r.STATUS_ID : r.STAGE_ID) ?? '';
  if (!stageId) return { ok: false, reason: `history ${r.ID}: empty stage` };
  const known = (entity === 'lead' ? dict.leadStatuses : dict.dealStages).get(stageId);
  const semantics = known?.semantics ?? parseSemantics(entity === 'lead' ? r.STATUS_SEMANTIC_ID : r.STAGE_SEMANTIC_ID);
  return {
    ok: true,
    row: {
      entityType: entity,
      bitrixId: r.ID,
      ownerId: r.OWNER_ID,
      typeId: r.TYPE_ID,
      bitrixStageId: stageId,
      stage: known?.stage ?? canonicalStage(entity, stageId, semantics, cfg.stageOverrides),
      categoryId: r.CATEGORY_ID,
      createdAt: r.CREATED_TIME,
    },
  };
}

/** При сдвиге offset-пагинации запись может прийти дважды: оставляем самую свежую версию. */
export function dedupeLatest<T extends { bitrixId: number; modifiedAt: Date }>(rows: T[]): T[] {
  const byId = new Map<number, T>();
  for (const row of rows) {
    const prev = byId.get(row.bitrixId);
    if (!prev || row.modifiedAt >= prev.modifiedAt) byId.set(row.bitrixId, row);
  }
  return [...byId.values()];
}
