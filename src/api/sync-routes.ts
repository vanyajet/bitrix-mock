import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { lastSuccessfulSyncAt } from '../db/sync-queries.js';
import { dataTotals, recentRuns, syncCursors } from '../db/queries/sync-status.js';
import { nextRunAt } from '../sync/scheduler.js';
import { SyncAlreadyRunningError } from '../sync/worker.js';
import { HttpError } from './errors.js';

const flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

const RunBody = z.object({ full: flag, wait: flag }).strict();

export async function syncRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { pool, env, sync } = ctx;

  app.get('/sync/status', async () => {
    const [runs, lastSuccess, cursors, totals] = await Promise.all([
      recentRuns(pool, 10),
      lastSuccessfulSyncAt(pool),
      syncCursors(pool),
      dataTotals(pool),
    ]);
    const [lastRun = null, ...rest] = runs;
    return {
      mode: env.BITRIX_MODE,
      running: sync?.isRunning ?? false,
      intervalMin: env.SYNC_INTERVAL_MIN,
      nextRunAt: nextRunAt(env.SYNC_INTERVAL_MIN).toISOString(),
      lastSuccessfulSyncAt: lastSuccess?.toISOString() ?? null,
      lastRun,
      recentRuns: rest.map(({ entities: _entities, ...run }) => run),
      cursors,
      totals,
    };
  });

  /**
   * Ручной запуск. По умолчанию отвечает 202 сразу (UI опрашивает /sync/status),
   * с wait=true ждёт окончания прогона и возвращает его результат. full=true - перечитать всё.
   */
  app.post('/sync/run', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!sync) throw new HttpError(503, 'SYNC_DISABLED', 'Sync service is not configured');
    const opts = RunBody.parse({ ...(req.query as object), ...((req.body as object | undefined) ?? {}) });
    if (sync.isRunning) throw new HttpError(409, 'SYNC_IN_PROGRESS', new SyncAlreadyRunningError().message);
    const run = sync.run('manual', { full: opts.full });
    if (opts.wait) {
      const result = await run;
      return reply.code(result.status === 'success' ? 200 : result.status === 'skipped' ? 409 : 500).send(result);
    }
    run.catch((err: unknown) => req.log.error({ err }, 'manual sync failed'));
    return reply.code(202).send({ status: 'started', runId: sync.currentRunId, full: opts.full });
  });
}
