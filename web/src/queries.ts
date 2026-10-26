import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from './api';
import { apiParams, type Filters } from './filters';
import type { MetaResponse, SyncStatusResponse } from './types';

/** Аналитический эндпоинт с фильтрами; при смене фильтров показывает прежние данные до прихода новых. */
export function useAnalytics<T>(endpoint: string, filters: Filters) {
  const params = apiParams(filters);
  return useQuery({
    queryKey: ['analytics', endpoint, params],
    queryFn: () => apiGet<T>(`/api/${endpoint}`, params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => apiGet<MetaResponse>('/api/meta'), staleTime: 5 * 60_000 });
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ['sync-status'],
    queryFn: () => apiGet<SyncStatusResponse>('/api/sync/status'),
    // пока идёт синк - опрашиваем часто, иначе раз в 30 секунд
    refetchInterval: (q) => (q.state.data?.running ? 2_000 : 30_000),
  });
}
