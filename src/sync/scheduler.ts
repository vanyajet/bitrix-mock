import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from '../logger.js';
import { SyncAlreadyRunningError, type SyncService } from './worker.js';

/** "*\/5 * * * *" для интервалов < 60 минут, иначе "0 *\/N * * *". */
export function cronExpression(intervalMin: number): string {
  if (intervalMin < 60) return `*/${intervalMin} * * * *`;
  return `0 */${Math.max(1, Math.round(intervalMin / 60))} * * *`;
}

/** Время следующего запуска для UI (cron срабатывает на минутах, кратных интервалу). */
export function nextRunAt(intervalMin: number, from = new Date()): Date {
  const step = intervalMin < 60 ? intervalMin : Math.round(intervalMin / 60) * 60;
  const next = new Date(from);
  next.setSeconds(0, 0);
  do next.setMinutes(next.getMinutes() + 1);
  while ((next.getHours() * 60 + next.getMinutes()) % step !== 0);
  return next;
}

export function startScheduler(sync: SyncService, intervalMin: number, logger: Logger): ScheduledTask {
  const expression = cronExpression(intervalMin);
  const task = cron.schedule(
    expression,
    async () => {
      try {
        await sync.run('cron');
      } catch (err) {
        if (err instanceof SyncAlreadyRunningError) logger.info('scheduled sync skipped: previous run still in progress');
        else logger.error({ err }, 'scheduled sync failed');
      }
    },
    { name: 'crm-sync', noOverlap: true },
  );
  logger.info({ expression }, 'sync scheduler started');
  return task;
}
