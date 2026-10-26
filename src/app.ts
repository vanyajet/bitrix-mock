import helmet from '@fastify/helmet';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import qs from 'qs';
import { registerDashboardAuth } from './api/auth.js';
import { registerErrorHandler } from './api/errors.js';
import { healthRoutes } from './api/health.js';
import type { AppContext } from './context.js';
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

  await app.register(healthRoutes, { prefix: '/api', ctx });
  await registerStatic(app);
  return app;
}
