-- Базовая схема: справочники Bitrix24, лиды/сделки, история стадий, расходы на рекламу,
-- планы и служебные таблицы синхронизации.

-- Сотрудники (user.get). vertical определяется по отделу через маппинг.
CREATE TABLE users (
  bitrix_id   bigint PRIMARY KEY,
  name        text NOT NULL,
  position    text,
  vertical    text CHECK (vertical IN ('dental', 'metal')),
  active      boolean NOT NULL DEFAULT true,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

-- Воронки сделок (crm.category.list).
CREATE TABLE categories (
  bitrix_id   integer PRIMARY KEY,
  name        text NOT NULL,
  vertical    text CHECK (vertical IN ('dental', 'metal')),
  synced_at   timestamptz NOT NULL DEFAULT now()
);

-- Статусы лидов и стадии сделок (crm.status.list, ENTITY_ID = STATUS | DEAL_STAGE[_N]),
-- с маппингом на канонические стадии.
CREATE TABLE stages (
  entity_type      text NOT NULL CHECK (entity_type IN ('lead', 'deal')),
  bitrix_stage_id  text NOT NULL,
  category_id      integer,
  name             text NOT NULL,
  semantics        text NOT NULL CHECK (semantics IN ('process', 'success', 'failure')),
  sort             integer NOT NULL DEFAULT 0,
  stage            text NOT NULL CHECK (stage IN ('NEW', 'IN_PROGRESS', 'NO_ANSWER', 'QUALIFIED', 'MEETING', 'WON', 'LOST')),
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, bitrix_stage_id)
);

-- Источники (crm.status.list, ENTITY_ID = SOURCE).
CREATE TABLE sources (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leads (
  bitrix_id         bigint PRIMARY KEY,
  title             text,
  vertical          text NOT NULL CHECK (vertical IN ('dental', 'metal')),
  segment           text,
  source            text,
  stage             text NOT NULL,
  bitrix_status_id  text NOT NULL,
  assigned_user_id  bigint,
  amount            numeric(14, 2) NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'RUB',
  created_at        timestamptz NOT NULL,
  modified_at       timestamptz NOT NULL,
  closed_at         timestamptz,
  -- Лид успешно сконвертирован (статус с семантикой success).
  is_won            boolean NOT NULL DEFAULT false,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_vertical_created_idx ON leads (vertical, created_at);
CREATE INDEX leads_vertical_source_created_idx ON leads (vertical, source, created_at);
CREATE INDEX leads_assigned_created_idx ON leads (assigned_user_id, created_at);

CREATE TABLE deals (
  bitrix_id         bigint PRIMARY KEY,
  lead_id           bigint,
  title             text,
  vertical          text NOT NULL CHECK (vertical IN ('dental', 'metal')),
  segment           text,
  source            text,
  stage             text NOT NULL,
  bitrix_stage_id   text NOT NULL,
  category_id       integer,
  assigned_user_id  bigint,
  amount            numeric(14, 2) NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'RUB',
  created_at        timestamptz NOT NULL,
  modified_at       timestamptz NOT NULL,
  closed_at         timestamptz,
  is_won            boolean NOT NULL DEFAULT false,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deals_lead_idx ON deals (lead_id);
CREATE INDEX deals_vertical_created_idx ON deals (vertical, created_at);
CREATE INDEX deals_assigned_created_idx ON deals (assigned_user_id, created_at);
-- Выручка всегда считается только по выигранным сделкам: частичный индекс покрывает эти запросы.
CREATE INDEX deals_won_closed_idx ON deals (vertical, closed_at) INCLUDE (amount, segment, assigned_user_id) WHERE is_won;

-- История переходов по стадиям (crm.stagehistory.list). Записи неизменяемые.
CREATE TABLE stage_history (
  entity_type      text NOT NULL CHECK (entity_type IN ('lead', 'deal')),
  bitrix_id        bigint NOT NULL,
  owner_id         bigint NOT NULL,
  -- 1 - создание, 2 - промежуточная стадия, 3 - финальная стадия, 5 - смена воронки
  type_id          smallint NOT NULL,
  bitrix_stage_id  text NOT NULL,
  stage            text NOT NULL,
  category_id      integer,
  created_at       timestamptz NOT NULL,
  PRIMARY KEY (entity_type, bitrix_id)
);

CREATE INDEX stage_history_owner_idx ON stage_history (entity_type, owner_id, created_at);

-- Расходы на рекламу из рекламных кабинетов (в демо - /mock/ads).
CREATE TABLE ad_spend (
  date         date NOT NULL,
  vertical     text NOT NULL CHECK (vertical IN ('dental', 'metal')),
  source       text NOT NULL,
  campaign     text NOT NULL,
  segment      text,
  impressions  integer NOT NULL DEFAULT 0,
  clicks       integer NOT NULL DEFAULT 0,
  spend        numeric(14, 2) NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'RUB',
  synced_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vertical, source, campaign, date)
);

CREATE INDEX ad_spend_vertical_date_idx ON ad_spend (vertical, date);

-- План выручки по месяцам и сегментам (бизнес-настройка, не из Bitrix).
CREATE TABLE plans (
  vertical      text NOT NULL CHECK (vertical IN ('dental', 'metal')),
  segment       text NOT NULL,
  month         date NOT NULL CHECK (month = date_trunc('month', month)::date),
  revenue_plan  numeric(14, 2) NOT NULL CHECK (revenue_plan >= 0),
  PRIMARY KEY (vertical, segment, month)
);

-- Журнал синхронизации: одна строка на сущность в рамках прогона run_id.
CREATE TABLE sync_runs (
  id           bigserial PRIMARY KEY,
  run_id       uuid NOT NULL,
  trigger      text NOT NULL CHECK (trigger IN ('startup', 'cron', 'manual', 'test')),
  entity       text NOT NULL,
  status       text NOT NULL CHECK (status IN ('running', 'success', 'failed', 'aborted')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  fetched      integer NOT NULL DEFAULT 0,
  upserted     integer NOT NULL DEFAULT 0,
  error        text
);

CREATE INDEX sync_runs_run_idx ON sync_runs (run_id);
CREATE INDEX sync_runs_started_idx ON sync_runs (started_at DESC);

-- Курсоры инкрементального синка по сущностям.
CREATE TABLE sync_state (
  entity         text PRIMARY KEY,
  last_modified  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
