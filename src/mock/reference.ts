// Справочники mock-портала в формате ответов Bitrix24 REST.

import { SOURCES } from '../config/domain.js';
import { MODELS, SOURCE_LABELS } from './model.js';

export type Semantic = 'P' | 'S' | 'F';

interface StatusDef {
  entityId: string;
  statusId: string;
  name: string;
  sort: number;
  semantic: Semantic;
  categoryId?: number;
  system: boolean;
}

const LEAD_STATUSES: StatusDef[] = [
  { entityId: 'STATUS', statusId: 'NEW', name: 'Не обработан', sort: 10, semantic: 'P', system: true },
  { entityId: 'STATUS', statusId: 'IN_PROCESS', name: 'В работе', sort: 20, semantic: 'P', system: false },
  { entityId: 'STATUS', statusId: 'PROCESSED', name: 'Обработан', sort: 30, semantic: 'P', system: false },
  { entityId: 'STATUS', statusId: 'CONVERTED', name: 'Качественный лид', sort: 40, semantic: 'S', system: true },
  { entityId: 'STATUS', statusId: 'JUNK', name: 'Некачественный лид', sort: 50, semantic: 'F', system: true },
  { entityId: 'STATUS', statusId: 'UC_NOANSWER', name: 'Не дозвонились', sort: 60, semantic: 'F', system: false },
];

function dealStages(categoryId: number, names: Record<string, string>): StatusDef[] {
  const prefix = categoryId === 0 ? '' : `C${categoryId}:`;
  const entityId = categoryId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`;
  const order: Array<[string, Semantic]> = [
    ['NEW', 'P'],
    ['PREPARATION', 'P'],
    ['PREPAYMENT_INVOICE', 'P'],
    ['EXECUTING', 'P'],
    ['WON', 'S'],
    ['LOSE', 'F'],
    ['APOLOGY', 'F'],
  ];
  return order
    .filter(([code]) => names[code])
    .map(([code, semantic], i) => ({
      entityId,
      statusId: `${prefix}${code}`,
      name: names[code]!,
      sort: (i + 1) * 10,
      semantic,
      categoryId,
      system: code === 'NEW' || code === 'WON' || code === 'LOSE',
    }));
}

const ALL_STATUSES: StatusDef[] = [
  ...LEAD_STATUSES,
  ...SOURCES.map((code, i) => ({
    entityId: 'SOURCE',
    statusId: code,
    name: SOURCE_LABELS[code],
    sort: (i + 1) * 10,
    semantic: 'P' as const,
    system: false,
  })),
  ...dealStages(0, { NEW: 'Новая', PREPARATION: 'Подготовка документов', EXECUTING: 'В работе', WON: 'Сделка успешна', LOSE: 'Сделка провалена' }),
  ...dealStages(1, { NEW: 'Запись на консультацию', PREPARATION: 'Консультация проведена', WON: 'Лечение оплачено', LOSE: 'Отказ', APOLOGY: 'Анализ причины отказа' }),
  ...dealStages(2, { NEW: 'Новая заявка', PREPARATION: 'Замер / встреча', PREPAYMENT_INVOICE: 'Договор и предоплата', WON: 'Объект сдан, оплачено', LOSE: 'Отказ' }),
];

export const SEMANTICS_BY_STATUS = new Map(ALL_STATUSES.map((s) => [s.statusId, s.semantic]));

const SEMANTIC_NAMES: Record<Semantic, string> = { P: 'process', S: 'success', F: 'failure' };

export function statusRows(): Array<Record<string, unknown>> {
  return ALL_STATUSES.map((s, i) => ({
    ID: String(i + 1),
    ENTITY_ID: s.entityId,
    STATUS_ID: s.statusId,
    NAME: s.name,
    NAME_INIT: s.system ? s.name : '',
    SORT: String(s.sort),
    SYSTEM: s.system ? 'Y' : 'N',
    CATEGORY_ID: s.categoryId === undefined ? null : String(s.categoryId),
    COLOR: s.semantic === 'S' ? '#7BD500' : s.semantic === 'F' ? '#FF5752' : '#39A8EF',
    SEMANTICS: s.semantic === 'P' ? null : s.semantic,
    EXTRA: s.entityId === 'SOURCE' ? undefined : { SEMANTICS: SEMANTIC_NAMES[s.semantic], COLOR: '#39A8EF' },
  }));
}

export function categoryRows(): Array<Record<string, unknown>> {
  return [
    { id: 0, name: 'Общая', sort: 0, entityTypeId: 2, isDefault: 'Y' },
    { id: MODELS.dental.categoryId, name: 'Стоматология', sort: 100, entityTypeId: 2, isDefault: 'N' },
    { id: MODELS.metal.categoryId, name: 'Металлоконструкции', sort: 200, entityTypeId: 2, isDefault: 'N' },
  ];
}

export function userRows(): Array<Record<string, unknown>> {
  const admin = { id: 1, name: 'Администратор', lastName: 'Портала', position: 'Администратор', departmentId: 1 };
  const staff = Object.values(MODELS).flatMap((m) =>
    m.managers.map((u) => ({ id: u.id, name: u.name, lastName: u.lastName, position: u.position, departmentId: m.departmentId })),
  );
  return [admin, ...staff].map((u) => ({
    ID: String(u.id),
    ACTIVE: true,
    NAME: u.name,
    LAST_NAME: u.lastName,
    SECOND_NAME: '',
    EMAIL: `user${u.id}@demo-portal.example`,
    WORK_POSITION: u.position,
    UF_DEPARTMENT: [u.departmentId],
    USER_TYPE: 'employee',
  }));
}

/** crm.lead.userfield.list / crm.deal.userfield.list: списочное поле сегмента со значениями обеих вертикалей. */
export function segmentUserFieldRows(entity: 'lead' | 'deal', fieldName: string): Array<Record<string, unknown>> {
  const segments = Object.values(MODELS).flatMap((m) => m.segments);
  return [
    {
      ID: entity === 'lead' ? '301' : '302',
      ENTITY_ID: entity === 'lead' ? 'CRM_LEAD' : 'CRM_DEAL',
      FIELD_NAME: fieldName,
      USER_TYPE_ID: 'enumeration',
      XML_ID: 'SEGMENT',
      SORT: '100',
      MULTIPLE: 'N',
      MANDATORY: 'N',
      LIST: segments.map((s, i) => ({
        ID: entity === 'lead' ? s.leadEnumId : s.dealEnumId,
        SORT: String((i + 1) * 10),
        VALUE: s.label,
        DEF: 'N',
        XML_ID: s.code,
      })),
    },
  ];
}
