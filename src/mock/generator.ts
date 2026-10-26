// Генерация лидов дня вместе с их будущей "судьбой": все переходы по стадиям и сделка рассчитываются сразу,
// а mock API показывает состояние на текущий момент. Поэтому данные живут во времени без отдельного таймера:
// приходят новые лиды, менеджеры двигают стадии, сделки закрываются.

import { fakerRU as faker } from '@faker-js/faker';
import { SOURCES, type Source, type Vertical } from '../config/domain.js';
import {
  expectedLeads,
  managerWeights,
  winRate,
  type ManagerDef,
  type SegmentDef,
  type VerticalModel,
  type WorkSchedule,
} from './model.js';
import { hashSeed, Rng } from './random.js';
import { DAY, HOUR, MINUTE, dayNoOf, dayStartMs } from './time.js';

export interface GenEvent {
  at: number;
  statusId: string;
  /** 1 - создание, 2 - промежуточная стадия, 3 - финальная */
  typeId: 1 | 2 | 3;
  /** ID записи истории; 0, пока событие за горизонтом генерации. */
  id: number;
}

export interface GenLead {
  id: number;
  vertical: Vertical;
  categoryId: number;
  createdAt: number;
  title: string;
  source: Source;
  segment: SegmentDef;
  managerId: number;
  amount: number;
  events: GenEvent[];
  deal: GenDeal | null;
}

export interface GenDeal {
  id: number;
  lead: GenLead;
  createdAt: number;
  amount: number;
  plannedClose: number;
  events: GenEvent[];
}

const METAL_OBJECTS: Record<string, readonly string[]> = {
  commercial: ['Торговый павильон', 'Автосервис', 'Склад-магазин', 'Офисное здание'],
  izhs: ['Каркас дома', 'Гараж', 'Навес', 'Баня на металлокаркасе'],
  industrial: ['Цех', 'Складской комплекс', 'Ангар', 'Производственный корпус'],
  agro: ['Зернохранилище', 'Коровник', 'Ангар для техники', 'Овощехранилище'],
};

/** Сдвигает момент в ближайшее рабочее время менеджеров. */
function toWorking(ms: number, schedule: WorkSchedule, rng: Rng): number {
  let t = ms;
  for (let i = 0; i < 10; i++) {
    const dayStart = dayStartMs(dayNoOf(t));
    const dow = ((new Date(t + 3 * HOUR).getUTCDay() + 6) % 7) + 1;
    const hours = schedule.hours[dow];
    if (hours) {
      const open = dayStart + hours[0] * HOUR;
      const close = dayStart + hours[1] * HOUR;
      if (t >= open && t < close) return t;
      if (t < open) return Math.min(open + rng.exp(25 * MINUTE), close - MINUTE);
    }
    t = dayStart + DAY;
  }
  return t;
}

/** Bitrix отдаёт даты с точностью до секунды; события одной записи строго упорядочены. */
function pushEvent(events: GenEvent[], at: number, statusId: string, typeId: GenEvent['typeId']): number {
  const prev = events[events.length - 1];
  const t = Math.floor(Math.max(at, prev ? prev.at + MINUTE : at) / 1000) * 1000;
  events.push({ at: t, statusId, typeId, id: 0 });
  return t;
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

function buildTitle(model: VerticalModel, segment: SegmentDef, rng: Rng): string {
  if (model.vertical === 'dental') return `${segment.label}: ${faker.person.fullName()}`;
  const objects = METAL_OBJECTS[segment.code] ?? ['Объект'];
  const object = objects[rng.int(0, objects.length - 1)];
  const area = roundTo(rng.logNormal(segment.code === 'izhs' ? 150 : 900, 0.5), 10);
  const client = segment.code === 'izhs' ? faker.person.fullName() : faker.company.name();
  return `${object} ${area} м² — ${client}`;
}

function buildDeal(model: VerticalModel, lead: GenLead, createdAt: number, rng: Rng): GenDeal {
  const c = `C${model.categoryId}:`;
  const s = model.schedule;
  const events: GenEvent[] = [];
  createdAt = pushEvent(events, createdAt, `${c}NEW`, 1);
  const push = (at: number, stage: string, typeId: 2 | 3) => pushEvent(events, at, `${c}${stage}`, typeId);
  const bigTicket = lead.segment.code === 'implant' || lead.segment.code === 'ortho';

  if (model.vertical === 'dental') {
    if (rng.chance(model.pMeeting)) {
      const meeting = push(toWorking(createdAt + rng.float(1, 10) * DAY, s, rng), 'PREPARATION', 2);
      if (rng.chance(model.pWinAfterMeeting)) {
        push(toWorking(meeting + (bigTicket ? rng.float(2, 21) : rng.float(0, 4)) * DAY, s, rng), 'WON', 3);
      } else {
        push(toWorking(meeting + rng.float(2, 20) * DAY, s, rng), 'LOSE', 3);
      }
    } else {
      push(toWorking(createdAt + rng.float(2, 14) * DAY, s, rng), 'LOSE', 3);
    }
  } else {
    const pContract = 0.72;
    if (rng.chance(model.pMeeting)) {
      const meeting = push(toWorking(createdAt + rng.float(3, 15) * DAY, s, rng), 'PREPARATION', 2);
      if (rng.chance(pContract)) {
        const contract = push(toWorking(meeting + rng.float(5, 25) * DAY, s, rng), 'PREPAYMENT_INVOICE', 2);
        if (rng.chance(model.pWinAfterMeeting / pContract)) {
          push(toWorking(contract + rng.float(7, 45) * DAY, s, rng), 'WON', 3);
        } else {
          push(toWorking(contract + rng.float(5, 30) * DAY, s, rng), 'LOSE', 3);
        }
      } else {
        push(toWorking(meeting + rng.float(5, 30) * DAY, s, rng), 'LOSE', 3);
      }
    } else {
      push(toWorking(createdAt + rng.float(3, 20) * DAY, s, rng), 'LOSE', 3);
    }
  }

  return {
    id: 0,
    lead,
    createdAt,
    amount: roundTo(lead.amount * rng.logNormal(1, 0.08), model.vertical === 'dental' ? 100 : 1000),
    plannedClose: createdAt + (model.vertical === 'dental' ? 10 : 45) * DAY,
    events,
  };
}

function buildLead(model: VerticalModel, createdAt: number, rng: Rng): GenLead {
  const source = rng.weighted(SOURCES.map((code) => [code, model.sources[code].share] as const));
  const segment = rng.weighted(model.segments.map((seg) => [seg, seg.share] as const));
  const manager: ManagerDef = rng.weighted(managerWeights(model, segment));
  const amount = roundTo(segment.avgCheck * manager.checkFactor * rng.logNormal(1, 0.35), model.vertical === 'dental' ? 500 : 10_000);
  const lead: GenLead = {
    id: 0,
    vertical: model.vertical,
    categoryId: model.categoryId,
    createdAt,
    title: buildTitle(model, segment, rng),
    source,
    segment,
    managerId: manager.id,
    amount,
    events: [],
    deal: null,
  };
  pushEvent(lead.events, createdAt, 'NEW', 1);
  if (rng.chance(model.neverProcessed)) return lead;

  const s = model.schedule;
  const dental = model.vertical === 'dental';
  const inWork = pushEvent(lead.events, toWorking(toWorking(createdAt, s, rng) + rng.exp(manager.responseMin) * MINUTE, s, rng), 'IN_PROCESS', 2);

  const pConvert = Math.min(0.93, winRate(model, manager, model.sources[source], segment) / (model.pMeeting * model.pWinAfterMeeting));
  if (rng.chance(pConvert)) {
    const converted = pushEvent(lead.events, toWorking(inWork + rng.exp(dental ? 5 : 26) * HOUR, s, rng), 'CONVERTED', 3);
    lead.deal = buildDeal(model, lead, converted + rng.int(1, 5) * MINUTE, rng);
  } else if (rng.chance(model.noAnswerShare)) {
    pushEvent(lead.events, toWorking(inWork + rng.float(dental ? 20 : 40, dental ? 72 : 120) * HOUR, s, rng), 'UC_NOANSWER', 3);
  } else {
    pushEvent(lead.events, toWorking(inWork + rng.exp(dental ? 4 : 12) * HOUR, s, rng), 'JUNK', 3);
  }
  return lead;
}

/** Все лиды вертикали за календарный день. Результат зависит только от (seed, вертикаль, день). */
export function generateDay(model: VerticalModel, dayNo: number, seed: number): GenLead[] {
  const rng = new Rng(hashSeed(seed, model.vertical, dayNo));
  faker.seed(hashSeed(seed, 'faker', model.vertical, dayNo));
  const count = rng.poisson(expectedLeads(model, dayNo) * rng.logNormal(1, 0.12));
  const start = dayStartMs(dayNo);
  const hourWeights = model.hourly.map((w, h) => [h, w] as const);

  const leads: GenLead[] = [];
  for (let i = 0; i < count; i++) {
    const hour = rng.weighted(hourWeights);
    const createdAt = start + hour * HOUR + Math.floor(rng.next() * HOUR / 1000) * 1000;
    leads.push(buildLead(model, createdAt, rng));
  }
  return leads.sort((a, b) => a.createdAt - b.createdAt);
}
