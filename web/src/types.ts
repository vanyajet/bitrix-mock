// Типы ответов /api/*. Все значения уже посчитаны на бэкенде.

export type Vertical = 'dental' | 'metal';

export interface Period {
  vertical: Vertical;
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  segment: string | null;
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  delta: number | null;
  deltaUnit: 'pct' | 'pp';
  format: 'number' | 'money' | 'percent';
  better: 'up' | 'down';
  hint?: string;
}

export interface Attribution {
  cohort: string;
  closed: string;
}

export interface OverviewResponse {
  period: Period;
  kpis: Kpi[];
  weekly: Array<{ week: string; leads: number; wonDeals: number; revenue: number }>;
  attribution: Attribution;
}

export interface SourceRow {
  source: string;
  name: string;
  leads: number;
  deals: number;
  won: number;
  revenue: number;
  spend: number;
  clicks: number;
  impressions: number;
  cpl: number | null;
  cpc: number | null;
  ctrPct: number | null;
  leadToDealPct: number | null;
  leadToWonPct: number | null;
  cac: number | null;
  romiPct: number | null;
  sharePct: number | null;
}

export interface MarketingResponse {
  period: Period;
  sources: SourceRow[];
  total: SourceRow;
  monthly: {
    sources: Array<{ code: string; name: string }>;
    leadsBySource: Array<Record<string, number | string>>;
    totals: Array<{ month: string; leads: number; won: number; revenue: number; spend: number; cpl: number | null }>;
  };
  attribution: Attribution;
}

export interface FunnelStep {
  stage: string;
  label: string;
  count: number;
  conversionFromPrevPct: number | null;
  conversionFromStartPct: number | null;
  lost: { noAnswer: number; rejected: number };
  inProgress: number;
  avgHoursOnStage: number | null;
}

export interface FunnelResponse {
  period: Period;
  steps: FunnelStep[];
  totals: { leads: number; won: number; conversionPct: number | null; lostNoAnswer: number; lostRejected: number; inProgress: number };
  attribution: Attribution;
}

export interface FinanceResponse {
  period: Period;
  kpis: Kpi[];
  revenueBySegment: { segments: string[]; rows: Array<Record<string, number | string>> };
  planFact: Array<{
    month: string;
    fact: number;
    plan: number;
    deals: number;
    avgCheck: number | null;
    completionPct: number | null;
    factCumulative: number;
    planCumulative: number;
  }>;
  topSegments: Array<{ segment: string; revenue: number; deals: number; avgCheck: number; sharePct: number | null; rank: number }>;
  attribution: Attribution;
}

export interface TeamMember {
  id: number;
  name: string;
  position: string | null;
  leads: number;
  wonCohort: number;
  wonDeals: number;
  revenue: number;
  conversionPct: number | null;
  avgCheck: number | null;
  avgResponseMin: number | null;
  medianResponseMin: number | null;
  noAnswerPct: number | null;
  revenueSharePct: number | null;
  revenueRank: number;
}

export interface TeamResponse {
  period: Period;
  members: TeamMember[];
  monthlyRevenue: { users: Array<{ id: string; name: string }>; rows: Array<Record<string, number | string>> };
  attribution: Attribution;
}

export interface MetaResponse {
  mode: 'mock' | 'live';
  timezone: string;
  syncIntervalMin: number;
  verticals: Array<{ code: Vertical; label: string; segments: string[] }>;
}

export interface SyncEntity {
  entity: string;
  status: string;
  fetched: number;
  upserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncRun {
  runId: string;
  trigger: string;
  status: 'running' | 'success' | 'failed' | 'aborted';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  fetched: number;
  upserted: number;
  error: string | null;
  entities?: SyncEntity[];
}

export interface SyncStatusResponse {
  mode: 'mock' | 'live';
  running: boolean;
  intervalMin: number;
  nextRunAt: string;
  lastSuccessfulSyncAt: string | null;
  lastRun: SyncRun | null;
  recentRuns: SyncRun[];
  totals: { leads: number; deals: number; history: number; adSpendDays: number };
}
