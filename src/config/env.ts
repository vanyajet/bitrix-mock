import { existsSync } from 'node:fs';
import { z } from 'zod';
import { STAGES, VERTICALS, type Vertical } from './domain.js';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/** "1:dental,2:metal" -> { '1': 'dental', '2': 'metal' } */
const verticalMap = z.string().transform((value, ctx) => {
  const result: Record<string, Vertical> = {};
  for (const pair of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [key, vertical] = pair.split(':').map((p) => p.trim());
    if (!key || !VERTICALS.includes(vertical as Vertical)) {
      ctx.addIssue({ code: 'custom', message: `invalid pair "${pair}", expected "<id>:<${VERTICALS.join('|')}>"` });
      return z.NEVER;
    }
    result[key] = vertical as Vertical;
  }
  return result;
});

/** '{"UC_CALLBACK":"IN_PROGRESS","C3:CONTRACT":"MEETING"}' - ручной маппинг статусов на канонические стадии. */
const stageMap = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'expected JSON object' });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.enum(STAGES)));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(5),
    APP_TZ: z
      .string()
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'unknown IANA time zone')
      .default('Europe/Moscow'),

    DASHBOARD_TOKEN: z.string().min(8, 'DASHBOARD_TOKEN must be at least 8 characters'),

    BITRIX_MODE: z.enum(['mock', 'live']).default('mock'),
    BITRIX_WEBHOOK_URL: z.url().optional(),
    BITRIX_RATE_LIMIT_RPS: z.coerce.number().positive().max(50).default(2),
    BITRIX_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    BITRIX_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
    /** Сколько страниц по 50 записей склеивать в один вызов batch при полном синке. 0 = без batch. */
    BITRIX_BATCH_PAGES: z.coerce.number().int().min(0).max(50).default(50),
    BITRIX_SEGMENT_FIELD: z.string().default('UF_CRM_SEGMENT'),
    BITRIX_LEAD_VERTICAL_FIELD: z.string().default('CATEGORY_ID'),
    BITRIX_LEAD_VERTICALS: verticalMap.default({ '1': 'dental', '2': 'metal' }),
    BITRIX_CATEGORY_VERTICALS: verticalMap.default({ '1': 'dental', '2': 'metal' }),
    BITRIX_DEPARTMENT_VERTICALS: verticalMap.default({ '10': 'dental', '20': 'metal' }),
    BITRIX_DEFAULT_VERTICAL: z.enum(VERTICALS).optional(),
    BITRIX_STAGE_MAP: stageMap.optional(),

    MOCK_WEBHOOK_TOKEN: z.string().min(6).default('mock-webhook-secret'),
    MOCK_SEED: z.coerce.number().int().default(20_241),

    /** По умолчанию включено только в mock-режиме: для реального портала нужен адаптер рекламного API. */
    ADS_ENABLED: bool.optional(),
    ADS_API_URL: z.url().optional(),
    ADS_API_TOKEN: z.string().default('mock-ads-secret'),

    SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).max(1440).default(5),
    SYNC_ON_START: bool.default(true),
    SYNC_CURSOR_OVERLAP_SEC: z.coerce.number().int().min(0).max(3600).default(120),
    CACHE_TTL_SEC: z.coerce.number().int().min(0).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.BITRIX_MODE === 'live' && !env.BITRIX_WEBHOOK_URL) {
      ctx.addIssue({ code: 'custom', path: ['BITRIX_WEBHOOK_URL'], message: 'required when BITRIX_MODE=live' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Пустые строки из .env/compose трактуем как "не задано", чтобы срабатывали дефолты.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export function loadDotEnv(file = '.env'): void {
  if (process.env.NODE_ENV !== 'production' && existsSync(file)) process.loadEnvFile(file);
}

/** URL вебхука, по которому ходит sync. В mock-режиме это собственный /mock/rest этого же процесса. */
export function bitrixWebhookUrl(env: Env): string {
  const url =
    env.BITRIX_MODE === 'live' && env.BITRIX_WEBHOOK_URL
      ? env.BITRIX_WEBHOOK_URL
      : `http://127.0.0.1:${env.PORT}/mock/rest/1/${env.MOCK_WEBHOOK_TOKEN}/`;
  return url.endsWith('/') ? url : `${url}/`;
}

export function adsEnabled(env: Env): boolean {
  return env.ADS_ENABLED ?? env.BITRIX_MODE === 'mock';
}

export function adsApiUrl(env: Env): string {
  return env.ADS_API_URL ?? `http://127.0.0.1:${env.PORT}/mock/ads`;
}
