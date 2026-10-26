import { adsApiUrl, adsEnabled, bitrixWebhookUrl, type Env } from '../config/env.js';
import { BitrixClient } from '../bitrix/client.js';
import type { Pool } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { AdsClient } from './ads-client.js';
import type { MappingConfig } from './mapping.js';
import { SyncService, type SyncConfig, type SyncServiceDeps } from './worker.js';

export function mappingConfigFromEnv(env: Env): MappingConfig {
  return {
    segmentField: env.BITRIX_SEGMENT_FIELD,
    leadVerticalField: env.BITRIX_LEAD_VERTICAL_FIELD,
    leadVerticals: env.BITRIX_LEAD_VERTICALS,
    categoryVerticals: env.BITRIX_CATEGORY_VERTICALS,
    departmentVerticals: env.BITRIX_DEPARTMENT_VERTICALS,
    defaultVertical: env.BITRIX_DEFAULT_VERTICAL,
    stageOverrides: env.BITRIX_STAGE_MAP ?? {},
  };
}

export function syncConfigFromEnv(env: Env): SyncConfig {
  return {
    mapping: mappingConfigFromEnv(env),
    timeZone: env.APP_TZ,
    cursorOverlapSec: env.SYNC_CURSOR_OVERLAP_SEC,
    batchPages: env.BITRIX_BATCH_PAGES,
    adsInitialDays: 500,
    adsRefreshDays: 3,
  };
}

export function createSyncService(
  env: Env,
  pool: Pool,
  logger: Logger,
  afterSuccess?: SyncServiceDeps['afterSuccess'],
): SyncService {
  const log = logger.child({ module: 'sync' });
  const bitrix = new BitrixClient({
    webhookUrl: bitrixWebhookUrl(env),
    rateLimitRps: env.BITRIX_RATE_LIMIT_RPS,
    timeoutMs: env.BITRIX_TIMEOUT_MS,
    maxRetries: env.BITRIX_MAX_RETRIES,
    logger: log,
  });
  const ads = adsEnabled(env) ? new AdsClient({ baseUrl: adsApiUrl(env), token: env.ADS_API_TOKEN }) : null;
  return new SyncService({ pool, logger: log, bitrix, ads, config: syncConfigFromEnv(env), afterSuccess });
}
