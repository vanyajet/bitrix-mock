// Бизнес-модель демо-данных: две вертикали на одной CRM-модели.
// Все параметры зависят только от абсолютной даты, поэтому данные дня одинаковы при любом "сегодня".

import type { Source, Vertical } from '../config/domain.js';
import { dayNoFromIso, localParts, dayStartMs } from './time.js';

/** С этого дня mock-портал "ведёт" CRM. ID записей идут по порядку от этой даты. */
export const ORIGIN_DAY = dayNoFromIso('2025-07-01');

export interface SegmentDef {
  code: string;
  label: string;
  /** ID значения списочного поля UF_CRM_SEGMENT у лида и у сделки (в Bitrix это разные поля). */
  leadEnumId: string;
  dealEnumId: string;
  share: number;
  avgCheck: number;
  convFactor: number;
}

export interface ManagerDef {
  id: number;
  name: string;
  lastName: string;
  position: string;
  /** Итоговая конверсия лид -> выигранная сделка при источнике среднего качества. */
  conversion: number;
  checkFactor: number;
  /** Средняя скорость первой реакции на лид, минуты рабочего времени. */
  responseMin: number;
  affinity: Partial<Record<string, number>>;
}

export interface SourceDef {
  share: number;
  quality: number;
  /** Целевая стоимость лида; 0 - бесплатный канал. */
  cpl: number;
  cpc: number;
  ctr: number;
}

export interface WorkSchedule {
  /** [час открытия, час закрытия) по дням недели, 1 = пн. null - выходной. */
  hours: Record<number, readonly [number, number] | null>;
}

export interface VerticalModel {
  vertical: Vertical;
  categoryId: number;
  departmentId: number;
  baseLeadsPerDay: number;
  season: readonly number[]; // 12 месяцев
  weekday: readonly number[]; // пн..вс
  hourly: readonly number[]; // 24 часа
  schedule: WorkSchedule;
  segments: readonly SegmentDef[];
  managers: readonly ManagerDef[];
  sources: Record<Source, SourceDef>;
  noAnswerShare: number;
  neverProcessed: number;
  /** Вероятность пройти встречу/консультацию и выиграть после неё (произведение даёт делитель конверсии). */
  pMeeting: number;
  pWinAfterMeeting: number;
  maxWinRate: number;
}

export const SOURCE_LABELS: Record<Source, string> = {
  google_ads: 'Google Ads',
  yandex_direct: 'Яндекс Директ',
  instagram: 'Instagram',
  seo: 'SEO (органика)',
  referral: 'Рекомендации',
  cold_call: 'Холодные звонки',
};

export const MODELS: Record<Vertical, VerticalModel> = {
  dental: {
    vertical: 'dental',
    categoryId: 1,
    departmentId: 10,
    baseLeadsPerDay: 26,
    // Спад летом и в январские праздники, пик осенью
    season: [0.85, 1.05, 1.12, 1.05, 0.95, 0.8, 0.7, 0.75, 1.05, 1.15, 1.15, 0.95],
    weekday: [1.1, 1.08, 1.05, 1.05, 1.0, 0.75, 0.55],
    hourly: [0.2, 0.1, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 1, 1.5, 1.8, 1.8, 1.6, 1.5, 1.5, 1.5, 1.6, 1.8, 1.9, 1.7, 1.3, 0.9, 0.6, 0.35],
    schedule: { hours: { 1: [9, 20], 2: [9, 20], 3: [9, 20], 4: [9, 20], 5: [9, 20], 6: [9, 20], 7: [10, 16] } },
    segments: [
      { code: 'therapy', label: 'Терапия', leadEnumId: '101', dealEnumId: '1101', share: 0.36, avgCheck: 14_000, convFactor: 1.1 },
      { code: 'implant', label: 'Имплантация', leadEnumId: '102', dealEnumId: '1102', share: 0.18, avgCheck: 110_000, convFactor: 0.8 },
      { code: 'ortho', label: 'Ортодонтия', leadEnumId: '103', dealEnumId: '1103', share: 0.14, avgCheck: 160_000, convFactor: 0.85 },
      { code: 'hygiene', label: 'Гигиена', leadEnumId: '104', dealEnumId: '1104', share: 0.32, avgCheck: 7_000, convFactor: 1.15 },
    ],
    managers: [
      { id: 11, name: 'Анна', lastName: 'Соколова', position: 'Врач-терапевт', conversion: 0.41, checkFactor: 0.95, responseMin: 20, affinity: { therapy: 3, hygiene: 1 } },
      { id: 12, name: 'Игорь', lastName: 'Лебедев', position: 'Хирург-имплантолог', conversion: 0.26, checkFactor: 1.15, responseMin: 45, affinity: { implant: 4, therapy: 0.5 } },
      { id: 13, name: 'Мария', lastName: 'Козлова', position: 'Врач-ортодонт', conversion: 0.33, checkFactor: 1.05, responseMin: 30, affinity: { ortho: 4 } },
      { id: 14, name: 'Дмитрий', lastName: 'Новиков', position: 'Врач-терапевт', conversion: 0.22, checkFactor: 0.9, responseMin: 90, affinity: { therapy: 2.5, hygiene: 0.5 } },
      { id: 15, name: 'Елена', lastName: 'Морозова', position: 'Гигиенист', conversion: 0.37, checkFactor: 1.0, responseMin: 25, affinity: { hygiene: 3, therapy: 0.5 } },
      { id: 16, name: 'Павел', lastName: 'Волков', position: 'Хирург-имплантолог', conversion: 0.225, checkFactor: 1.25, responseMin: 120, affinity: { implant: 3, ortho: 0.5 } },
    ],
    sources: {
      yandex_direct: { share: 0.3, quality: 1.0, cpl: 1_900, cpc: 48, ctr: 0.035 },
      google_ads: { share: 0.14, quality: 0.95, cpl: 2_300, cpc: 55, ctr: 0.028 },
      instagram: { share: 0.22, quality: 0.65, cpl: 950, cpc: 22, ctr: 0.009 },
      seo: { share: 0.16, quality: 1.2, cpl: 650, cpc: 0, ctr: 0.04 },
      referral: { share: 0.13, quality: 1.55, cpl: 0, cpc: 0, ctr: 0 },
      cold_call: { share: 0.05, quality: 0.55, cpl: 1_400, cpc: 0, ctr: 0 },
    },
    noAnswerShare: 0.45,
    neverProcessed: 0.012,
    pMeeting: 0.82,
    pWinAfterMeeting: 0.78,
    maxWinRate: 0.62,
  },
  metal: {
    vertical: 'metal',
    categoryId: 2,
    departmentId: 20,
    baseLeadsPerDay: 11,
    // Строительный сезон: рост весной, пик летом, спад зимой
    season: [0.55, 0.65, 0.9, 1.15, 1.3, 1.35, 1.3, 1.3, 1.25, 1.1, 0.8, 0.6],
    weekday: [1.2, 1.15, 1.1, 1.1, 1.0, 0.35, 0.2],
    hourly: [0.05, 0.02, 0.02, 0.02, 0.02, 0.05, 0.2, 0.6, 1.4, 2, 2.1, 2, 1.6, 1.8, 1.9, 1.8, 1.6, 1.2, 0.7, 0.5, 0.4, 0.3, 0.15, 0.08],
    schedule: { hours: { 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: null, 7: null } },
    segments: [
      { code: 'commercial', label: 'Коммерческие помещения', leadEnumId: '201', dealEnumId: '1201', share: 0.34, avgCheck: 1_600_000, convFactor: 1.0 },
      { code: 'izhs', label: 'ИЖС', leadEnumId: '202', dealEnumId: '1202', share: 0.3, avgCheck: 700_000, convFactor: 1.1 },
      { code: 'industrial', label: 'Промышленность', leadEnumId: '203', dealEnumId: '1203', share: 0.22, avgCheck: 3_900_000, convFactor: 0.8 },
      { code: 'agro', label: 'Агро', leadEnumId: '204', dealEnumId: '1204', share: 0.14, avgCheck: 2_200_000, convFactor: 0.95 },
    ],
    managers: [
      { id: 21, name: 'Андрей', lastName: 'Кузнецов', position: 'Ведущий менеджер', conversion: 0.21, checkFactor: 1.1, responseMin: 30, affinity: { commercial: 2, industrial: 2 } },
      { id: 22, name: 'Ольга', lastName: 'Смирнова', position: 'Менеджер по продажам', conversion: 0.16, checkFactor: 0.9, responseMin: 45, affinity: { izhs: 3, commercial: 1 } },
      { id: 23, name: 'Сергей', lastName: 'Попов', position: 'Менеджер по продажам', conversion: 0.12, checkFactor: 1.0, responseMin: 120, affinity: { agro: 2, izhs: 1, industrial: 0.5 } },
      { id: 24, name: 'Наталья', lastName: 'Васильева', position: 'Менеджер по ключевым клиентам', conversion: 0.24, checkFactor: 1.3, responseMin: 40, affinity: { industrial: 3, commercial: 1 } },
      { id: 25, name: 'Максим', lastName: 'Фёдоров', position: 'Менеджер по продажам', conversion: 0.09, checkFactor: 0.95, responseMin: 180, affinity: { izhs: 2, agro: 2, commercial: 1 } },
    ],
    sources: {
      yandex_direct: { share: 0.3, quality: 1.0, cpl: 5_200, cpc: 85, ctr: 0.025 },
      google_ads: { share: 0.18, quality: 0.95, cpl: 6_100, cpc: 95, ctr: 0.022 },
      instagram: { share: 0.06, quality: 0.65, cpl: 3_400, cpc: 40, ctr: 0.007 },
      seo: { share: 0.2, quality: 1.2, cpl: 1_800, cpc: 0, ctr: 0.04 },
      referral: { share: 0.1, quality: 1.55, cpl: 0, cpc: 0, ctr: 0 },
      cold_call: { share: 0.16, quality: 0.55, cpl: 2_600, cpc: 0, ctr: 0 },
    },
    noAnswerShare: 0.35,
    neverProcessed: 0.008,
    pMeeting: 0.65,
    pWinAfterMeeting: 0.5,
    maxWinRate: 0.32,
  },
};

/** Рост бизнеса: +32% в год от даты старта портала. */
export function growthFactor(dayNo: number): number {
  return 1 + (0.32 * (dayNo - ORIGIN_DAY)) / 365;
}

/** Сезонность с линейной интерполяцией между серединами месяцев, чтобы не было ступенек на графиках. */
export function seasonFactor(model: VerticalModel, dayNo: number): number {
  const p = localParts(dayStartMs(dayNo) + 12 * 3_600_000);
  const pos = p.month - 1 + (p.day - 0.5) / p.daysInMonth - 0.5;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const at = (m: number) => model.season[((m % 12) + 12) % 12]!;
  return at(lo) * (1 - frac) + at(lo + 1) * frac;
}

/** Ожидаемое число лидов за день (без шума). Используется генератором, расходами на рекламу и планами. */
export function expectedLeads(model: VerticalModel, dayNo: number): number {
  const dow = localParts(dayStartMs(dayNo) + 12 * 3_600_000).dow;
  return model.baseLeadsPerDay * seasonFactor(model, dayNo) * model.weekday[dow - 1]! * growthFactor(dayNo);
}

/** Вероятность выигрыша для конкретной комбинации менеджер/источник/сегмент. */
export function winRate(model: VerticalModel, manager: ManagerDef, source: SourceDef, segment: SegmentDef): number {
  return Math.min(model.maxWinRate, manager.conversion * source.quality * segment.convFactor);
}

export function managerWeights(model: VerticalModel, segment: SegmentDef): Array<readonly [ManagerDef, number]> {
  return model.managers.map((m) => [m, m.affinity[segment.code] ?? 0.05] as const);
}
