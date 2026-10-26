import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { lastSuccessfulSyncAt } from '../db/sync-queries.js';

export async function healthRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let db: 'ok' | 'error' = 'ok';
    let lastSuccess: Date | null = null;
    try {
      lastSuccess = await lastSuccessfulSyncAt(ctx.pool);
    } catch (err) {
      db = 'error';
      app.log.error({ err }, 'health check: database unavailable');
    }
    const ageSec = lastSuccess ? Math.round((Date.now() - lastSuccess.getTime()) / 1000) : null;
    const stale = ageSec === null || ageSec > ctx.env.SYNC_INTERVAL_MIN * 60 * 3;
    return reply.code(db === 'ok' ? 200 : 503).send({
      status: db === 'error' ? 'error' : stale ? 'degraded' : 'ok',
      db,
      mode: ctx.env.BITRIX_MODE,
      lastSuccessfulSyncAt: lastSuccess?.toISOString() ?? null,
      lastSyncAgeSec: ageSec,
      uptimeSec: Math.round(process.uptime()),
    });
  });
}
