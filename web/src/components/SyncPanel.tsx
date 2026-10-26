import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../api';
import { formatAgo, formatDateTime, formatDuration, formatNumber, formatTime } from '../format';
import { useSyncStatus } from '../queries';
import type { SyncRun } from '../types';

const STATUS_LABEL: Record<SyncRun['status'], string> = {
  running: 'Выполняется',
  success: 'Успешно',
  failed: 'Ошибка',
  aborted: 'Прерван',
};

const STATUS_STYLE: Record<SyncRun['status'], string> = {
  running: 'bg-accent-soft text-accent',
  success: 'bg-good/10 text-good',
  failed: 'bg-bad/10 text-bad',
  aborted: 'bg-warn/10 text-warn',
};

const ENTITY_LABEL: Record<string, string> = {
  dictionaries: 'Справочники',
  leads: 'Лиды',
  deals: 'Сделки',
  lead_history: 'История лидов',
  deal_history: 'История сделок',
  ad_spend: 'Расходы на рекламу',
};

function StatusBadge({ status }: { status: SyncRun['status'] }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      <span aria-hidden>{status === 'success' ? '✓' : status === 'running' ? '↻' : '!'}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SyncPanel() {
  const status = useSyncStatus();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => apiPost<{ runId: string }>('/api/sync/run'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sync-status'] }),
  });

  // Завершился новый успешный прогон - перечитываем все графики.
  const lastSeen = useRef<string | null>(null);
  const last = status.data?.lastRun;
  useEffect(() => {
    if (!last || last.status === 'running') return;
    if (lastSeen.current && lastSeen.current !== last.runId && last.status === 'success') {
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['meta'] });
    }
    lastSeen.current = last.runId;
  }, [last, queryClient]);

  const data = status.data;
  const running = Boolean(data?.running) || run.isPending;

  return (
    <footer className="mt-8 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Синхронизация</span>
            {data && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${data.mode === 'live' ? 'bg-good/10 text-good' : 'bg-accent-soft text-accent'}`}
                title={data.mode === 'live' ? 'Реальный портал Bitrix24 по вебхуку' : 'Встроенный эмулятор Bitrix24 REST API'}>
                {data.mode}
              </span>
            )}
          </div>

          {status.isError && <span className="text-sm text-bad">Статус недоступен: {(status.error as Error).message}</span>}
          {data && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted">Последний прогон</dt>
                <dd className="flex items-center gap-2 text-ink">
                  {last ? (
                    <>
                      <StatusBadge status={running ? 'running' : last.status} />
                      <span title={formatDateTime(last.startedAt)}>{formatAgo(last.startedAt)}</span>
                    </>
                  ) : (
                    'ещё не было'
                  )}
                </dd>
              </div>
              {last && last.status !== 'running' && (
                <>
                  <div className="flex gap-2"><dt className="text-muted">Длительность</dt><dd className="tabular text-ink">{formatDuration(last.durationMs)}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted">Обновлено записей</dt><dd className="tabular text-ink">{formatNumber(last.upserted)}</dd></div>
                </>
              )}
              <div className="flex gap-2"><dt className="text-muted">Следующий</dt><dd className="tabular text-ink">{formatTime(data.nextRunAt)} (каждые {data.intervalMin} мин)</dd></div>
              <div className="flex gap-2"><dt className="text-muted">В базе</dt><dd className="tabular text-ink">{formatNumber(data.totals.leads)} лидов · {formatNumber(data.totals.deals)} сделок</dd></div>
            </dl>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setOpen((v) => !v)} className="rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink" aria-expanded={open}>
              {open ? 'Скрыть детали' : 'Детали'}
            </button>
            <button onClick={() => run.mutate()} disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              <span className={running ? 'animate-spin' : ''} aria-hidden>↻</span>
              {running ? 'Синхронизация…' : 'Синхронизировать сейчас'}
            </button>
          </div>
        </div>

        {run.isError && <p className="mt-2 text-sm text-bad">{(run.error as Error).message}</p>}
        {last?.error && <p className="mt-2 text-sm text-bad">Ошибка последнего прогона: {last.error}</p>}

        {open && data && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted uppercase">Последний прогон по сущностям</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted"><th className="py-1 text-left font-medium">Сущность</th><th className="text-right font-medium">Получено</th><th className="text-right font-medium">Записано</th><th className="text-right font-medium">Статус</th></tr></thead>
                <tbody>
                  {last?.entities?.map((e) => (
                    <tr key={e.entity} className="border-t border-line/60">
                      <td className="py-1.5 text-ink">{ENTITY_LABEL[e.entity] ?? e.entity}</td>
                      <td className="tabular text-right text-ink-2">{formatNumber(e.fetched)}</td>
                      <td className="tabular text-right text-ink">{formatNumber(e.upserted)}</td>
                      <td className="text-right"><StatusBadge status={e.status as SyncRun['status']} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">«Записано» - только реально изменившиеся строки: повторный синк без изменений даёт 0.</p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted uppercase">Предыдущие прогоны</h3>
              <ul className="space-y-1.5 text-sm">
                {data.recentRuns.map((r) => (
                  <li key={r.runId} className="flex items-center justify-between gap-3 border-t border-line/60 pt-1.5">
                    <span className="text-ink-2">{formatDateTime(r.startedAt)} · {r.trigger}</span>
                    <span className="tabular text-ink-2">{formatDuration(r.durationMs)} · {formatNumber(r.upserted)} зап.</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
                {data.recentRuns.length === 0 && <li className="text-muted">Пока нет</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}
