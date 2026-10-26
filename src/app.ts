import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import qs from 'qs';
import { registerDashboardAuth } from './api/auth.js';
import { registerErrorHandler } from './api/errors.js';
import { analyticsRoutes } from './api/analytics-routes.js';
import { healthRoutes } from './api/health.js';
import { syncRoutes } from './api/sync-routes.js';
import { adsEnabled } from './config/env.js';
import type { AppContext } from './context.js';
import { mockAdsRoutes } from './mock/ads.js';
import { mockBitrixRoutes } from './mock/bitrix-api.js';
import { registerStatic } from './static.js';

/** Одна строка лога на запрос вместо пары incoming/completed. */
class CompactLogController extends LogController {
  override incomingRequest(): void {}
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.logger,
    trustProxy: true,
    routerOptions: {
      // Bitrix-стиль параметров: filter[>DATE_MODIFY]=...&select[]=ID
      querystringParser: (str) => qs.parse(str, { arrayLimit: 1000, depth: 5, parameterLimit: 5000 }),
    },
    logController: new CompactLogController({
      // mock-трафик синка (сотни запросов за прогон) не засоряет логи
      disableRequestLogging: (req) => req.url.startsWith('/mock/'),
    }),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  });
  registerErrorHandler(app);
  registerDashboardAuth(app, ctx.env.DASHBOARD_TOKEN);

  const { env, mockStore } = ctx;
  if (mockStore) {
    await app.register(mockBitrixRoutes, { prefix: '/mock', store: mockStore, token: env.MOCK_WEBHOOK_TOKEN, rateLimitRps: 2 });
  }
  if (adsEnabled(env) && !env.ADS_API_URL) {
    const clock = mockStore ? () => mockStore.now() : Date.now;
    await app.register(mockAdsRoutes, { prefix: '/mock/ads', token: env.ADS_API_TOKEN, seed: env.MOCK_SEED, clock });
  }

  await app.register(
    async (api) => {
      // Лимит только для /api: mock-эндпоинты имеют свой лимит "как у Bitrix", статика - без лимита.
      await api.register(rateLimit, { max: 300, timeWindow: '1 minute' });
      await api.register(healthRoutes, { ctx });
      await api.register(analyticsRoutes, { ctx });
      await api.register(syncRoutes, { ctx });
    },
    { prefix: '/api' },
  );
  await registerStatic(app);
  return app;
}
