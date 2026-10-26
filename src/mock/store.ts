// In-memory "портал": генерирует дни от ORIGIN_DAY до сегодня и отдаёт срез состояния на момент запроса.
//
// ID выдаются как автоинкремент Bitrix - по порядку создания. Чтобы они не зависели от момента старта
// процесса, ID получают только записи, созданные до конца уже сгенерированного дня ("горизонт"):
// сделку или запись истории, созданную позже, мог бы опередить лид следующего дня.

import { generateDay, type GenDeal, type GenEvent, type GenLead } from './generator.js';
import type { EntityDef, Row } from './list-engine.js';
import { MODELS, ORIGIN_DAY } from './model.js';
import { SEMANTICS_BY_STATUS } from './reference.js';
import { dayNoOf, dayStartMs } from './time.js';

export const SEGMENT_FIELD = 'UF_CRM_SEGMENT';

export const LEAD_DEF: EntityDef = {
  fields: {
    ID: 'int',
    TITLE: 'string',
    STATUS_ID: 'string',
    STATUS_SEMANTIC_ID: 'string',
    SOURCE_ID: 'string',
    ASSIGNED_BY_ID: 'int',
    CREATED_BY_ID: 'int',
    DATE_CREATE: 'datetime',
    DATE_MODIFY: 'datetime',
    DATE_CLOSED: 'datetime',
    OPPORTUNITY: 'money',
    CURRENCY_ID: 'string',
    CATEGORY_ID: 'int',
    OPENED: 'string',
    IS_RETURN_CUSTOMER: 'string',
    [SEGMENT_FIELD]: 'string',
  },
};

export const DEAL_DEF: EntityDef = {
  fields: {
    ID: 'int',
    TITLE: 'string',
    LEAD_ID: 'int',
    STAGE_ID: 'string',
    STAGE_SEMANTIC_ID: 'string',
    CATEGORY_ID: 'int',
    SOURCE_ID: 'string',
    ASSIGNED_BY_ID: 'int',
    OPPORTUNITY: 'money',
    CURRENCY_ID: 'string',
    CLOSED: 'string',
    BEGINDATE: 'datetime',
    CLOSEDATE: 'datetime',
    DATE_CREATE: 'datetime',
    DATE_MODIFY: 'datetime',
    OPENED: 'string',
    [SEGMENT_FIELD]: 'string',
  },
};

export const LEAD_HISTORY_DEF: EntityDef = {
  intAsNumber: true,
  fields: { ID: 'int', TYPE_ID: 'int', OWNER_ID: 'int', CREATED_TIME: 'datetime', STATUS_SEMANTIC_ID: 'string', STATUS_ID: 'string' },
};

export const DEAL_HISTORY_DEF: EntityDef = {
  intAsNumber: true,
  fields: {
    ID: 'int',
    TYPE_ID: 'int',
    OWNER_ID: 'int',
    CREATED_TIME: 'datetime',
    CATEGORY_ID: 'int',
    STAGE_SEMANTIC_ID: 'string',
    STAGE_ID: 'string',
  },
};

interface HistoryRef {
  event: GenEvent;
  ownerId: () => number;
  categoryId: number | null;
}

export interface Snapshot {
  now: number;
  leads(): Row[];
  deals(): Row[];
  leadHistory(): Row[];
  dealHistory(): Row[];
  memo: Map<string, Map<string, Row[]>>;
}

export interface MockStoreOptions {
  seed: number;
  /** Текущее время в мс; в тестах подменяется, чтобы "проматывать" жизнь портала. */
  clock?: () => number;
  /**
   * Шаг среза, мс. Срез (и отсортированные выборки list-методов) переиспользуется в пределах шага:
   * на слабом CPU пачка batch-запросов полного синка не пересобирает 20 тыс. записей на каждый запрос.
   */
  snapshotStepMs?: number;
}

/** Текущее состояние: последнее событие, случившееся не позже now (события отсортированы по времени). */
function stateAt(events: GenEvent[], now: number): GenEvent {
  for (let i = events.length - 1; i > 0; i--) if (events[i]!.at <= now) return events[i]!;
  return events[0]!;
}

/** Сколько элементов отсортированного по времени массива уже наступило к моменту now. */
function visibleCount<T>(items: T[], time: (item: T) => number, now: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (time(items[mid]!) <= now) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function assignIds<T>(pending: T[], horizon: number, time: (t: T) => number, tie: (t: T) => number, assign: (t: T) => void): T[] {
  const ready: T[] = [];
  const rest: T[] = [];
  for (const item of pending) (time(item) < horizon ? ready : rest).push(item);
  ready.sort((a, b) => time(a) - time(b) || tie(a) - tie(b)).forEach(assign);
  return rest;
}

export class MockStore {
  readonly seed: number;
  private readonly clock: () => number;
  private generatedThrough = ORIGIN_DAY - 1;
  private readonly leads: GenLead[] = [];
  private readonly deals: GenDeal[] = [];
  private readonly leadHistory: HistoryRef[] = [];
  private readonly dealHistory: HistoryRef[] = [];
  private pendingDeals: GenDeal[] = [];
  private pendingLeadEvents: HistoryRef[] = [];
  private pendingDealEvents: HistoryRef[] = [];
  private readonly ids = { lead: 1, deal: 1, leadHistory: 1, dealHistory: 1 };
  private snapshotCache: Snapshot | null = null;
  private readonly snapshotStepMs: number;

  constructor({ seed, clock = Date.now, snapshotStepMs = 15_000 }: MockStoreOptions) {
    this.seed = seed;
    this.clock = clock;
    this.snapshotStepMs = snapshotStepMs;
  }

  /**
   * Генерация истории без блокировки event loop: на 0.1 CPU (бесплатный Render) она занимает десятки
   * секунд, и всё это время health-check и API должны отвечать. Между днями отдаём управление циклу событий.
   */
  async warmUp(): Promise<void> {
    const target = dayNoOf(this.clock());
    while (this.generatedThrough < target) {
      this.generateNextDay();
      if (this.generatedThrough % 5 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }

  now(): number {
    return this.clock();
  }

  /** Догенерировать дни до текущего (при старте - вся история, дальше - по одному дню в сутки). */
  ensureGenerated(now = this.clock()): void {
    const target = dayNoOf(now);
    while (this.generatedThrough < target) this.generateNextDay();
  }

  private generateNextDay(): void {
    const day = ++this.generatedThrough;
    const horizon = dayStartMs(day + 1);
    const dayLeads = [...generateDay(MODELS.dental, day, this.seed), ...generateDay(MODELS.metal, day, this.seed)].sort(
      (a, b) => a.createdAt - b.createdAt || a.categoryId - b.categoryId,
    );

    for (const lead of dayLeads) {
      lead.id = this.ids.lead++;
      this.leads.push(lead);
      if (lead.deal) this.pendingDeals.push(lead.deal);
      for (const event of lead.events) this.pendingLeadEvents.push({ event, ownerId: () => lead.id, categoryId: null });
    }

    this.pendingDeals = assignIds(
      this.pendingDeals,
      horizon,
      (d) => d.createdAt,
      (d) => d.lead.id,
      (deal) => {
        deal.id = this.ids.deal++;
        this.deals.push(deal);
        for (const event of deal.events) {
          this.pendingDealEvents.push({ event, ownerId: () => deal.id, categoryId: deal.lead.categoryId });
        }
      },
    );
    const byTime = (h: HistoryRef) => h.event.at;
    const byOwner = (h: HistoryRef) => h.ownerId();
    this.pendingLeadEvents = assignIds(this.pendingLeadEvents, horizon, byTime, byOwner, (h) => {
      h.event.id = this.ids.leadHistory++;
      this.leadHistory.push(h);
    });
    this.pendingDealEvents = assignIds(this.pendingDealEvents, horizon, byTime, byOwner, (h) => {
      h.event.id = this.ids.dealHistory++;
      this.dealHistory.push(h);
    });
    this.snapshotCache = null;
  }

  /** Срез портала на текущий момент (с шагом snapshotStepMs); строки собираются лениво и кэшируются на шаг. */
  snapshot(): Snapshot {
    const now = Math.floor(this.clock() / this.snapshotStepMs) * this.snapshotStepMs;
    this.ensureGenerated(now);
    if (this.snapshotCache?.now === now) return this.snapshotCache;

    const lazy = (build: () => Row[]) => {
      let rows: Row[] | null = null;
      return () => (rows ??= build());
    };
    const snap: Snapshot = {
      now,
      leads: lazy(() => this.leads.slice(0, visibleCount(this.leads, (l) => l.createdAt, now)).map((l) => this.leadRow(l, now))),
      deals: lazy(() => this.deals.slice(0, visibleCount(this.deals, (d) => d.createdAt, now)).map((d) => this.dealRow(d, now))),
      leadHistory: lazy(() =>
        this.leadHistory.slice(0, visibleCount(this.leadHistory, (h) => h.event.at, now)).map((h) => this.historyRow(h, 'lead')),
      ),
      dealHistory: lazy(() =>
        this.dealHistory.slice(0, visibleCount(this.dealHistory, (h) => h.event.at, now)).map((h) => this.historyRow(h, 'deal')),
      ),
      memo: new Map(),
    };
    this.snapshotCache = snap;
    return snap;
  }

  private leadRow(lead: GenLead, now: number): Row {
    const state = stateAt(lead.events, now);
    return {
      ID: lead.id,
      TITLE: lead.title,
      STATUS_ID: state.statusId,
      STATUS_SEMANTIC_ID: SEMANTICS_BY_STATUS.get(state.statusId) ?? 'P',
      SOURCE_ID: lead.source,
      ASSIGNED_BY_ID: lead.managerId,
      CREATED_BY_ID: 1,
      DATE_CREATE: lead.createdAt,
      DATE_MODIFY: state.at,
      DATE_CLOSED: state.typeId === 3 ? state.at : null,
      OPPORTUNITY: lead.amount,
      CURRENCY_ID: 'RUB',
      CATEGORY_ID: lead.categoryId,
      OPENED: 'Y',
      IS_RETURN_CUSTOMER: 'N',
      [SEGMENT_FIELD]: lead.segment.leadEnumId,
    };
  }

  private dealRow(deal: GenDeal, now: number): Row {
    const state = stateAt(deal.events, now);
    const closed = state.typeId === 3;
    // CLOSEDATE в Bitrix - дата без времени: плановая для открытой сделки, фактическая для закрытой.
    const closeDate = dayStartMs(dayNoOf(closed ? state.at : deal.plannedClose));
    return {
      ID: deal.id,
      TITLE: deal.lead.title,
      LEAD_ID: deal.lead.id,
      STAGE_ID: state.statusId,
      STAGE_SEMANTIC_ID: SEMANTICS_BY_STATUS.get(state.statusId) ?? 'P',
      CATEGORY_ID: deal.lead.categoryId,
      SOURCE_ID: deal.lead.source,
      ASSIGNED_BY_ID: deal.lead.managerId,
      OPPORTUNITY: deal.amount,
      CURRENCY_ID: 'RUB',
      CLOSED: closed ? 'Y' : 'N',
      BEGINDATE: dayStartMs(dayNoOf(deal.createdAt)),
      CLOSEDATE: closeDate,
      DATE_CREATE: deal.createdAt,
      DATE_MODIFY: state.at,
      OPENED: 'Y',
      [SEGMENT_FIELD]: deal.lead.segment.dealEnumId,
    };
  }

  private historyRow(h: HistoryRef, entity: 'lead' | 'deal'): Row {
    const semantic = SEMANTICS_BY_STATUS.get(h.event.statusId) ?? 'P';
    const base = { ID: h.event.id, TYPE_ID: h.event.typeId, OWNER_ID: h.ownerId(), CREATED_TIME: h.event.at };
    return entity === 'lead'
      ? { ...base, STATUS_SEMANTIC_ID: semantic, STATUS_ID: h.event.statusId }
      : { ...base, CATEGORY_ID: h.categoryId, STAGE_SEMANTIC_ID: semantic, STAGE_ID: h.event.statusId };
  }

  stats(): { leads: number; deals: number; leadHistory: number; dealHistory: number; generatedThrough: number } {
    const snap = this.snapshot();
    return {
      leads: snap.leads().length,
      deals: snap.deals().length,
      leadHistory: snap.leadHistory().length,
      dealHistory: snap.dealHistory().length,
      generatedThrough: this.generatedThrough,
    };
  }
}
