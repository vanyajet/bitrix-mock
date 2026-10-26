// Нормализованная модель, к которой приводятся данные любого портала Bitrix24.

export const VERTICALS = ['dental', 'metal'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_LABELS: Record<Vertical, string> = {
  dental: 'Стоматология',
  metal: 'Металлоконструкции',
};

/** Канонические стадии из ТЗ. Реальные статусы лидов и стадии сделок маппятся на них при синке. */
export const STAGES = ['NEW', 'IN_PROGRESS', 'NO_ANSWER', 'QUALIFIED', 'MEETING', 'WON', 'LOST'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: 'Новый лид',
  IN_PROGRESS: 'В работе',
  NO_ANSWER: 'Не дозвонились',
  QUALIFIED: 'Квалифицирован',
  MEETING: 'Встреча / консультация',
  WON: 'Успешно',
  LOST: 'Отказ',
};

/** Шаги воронки по порядку. NO_ANSWER и LOST - не шаги, а исходы-потери. */
export const FUNNEL_STEPS = ['NEW', 'IN_PROGRESS', 'QUALIFIED', 'MEETING', 'WON'] as const satisfies readonly Stage[];

export const SOURCES = ['google_ads', 'yandex_direct', 'instagram', 'seo', 'referral', 'cold_call'] as const;
export type Source = (typeof SOURCES)[number];

export type Semantics = 'process' | 'success' | 'failure';
