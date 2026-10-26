import { Header } from './components/Header';
import { SyncPanel } from './components/SyncPanel';
import { useFilters } from './filters';
import { useMeta } from './queries';
import { FinanceTab } from './tabs/Finance';
import { FunnelTab } from './tabs/Funnel';
import { MarketingTab } from './tabs/Marketing';
import { OverviewTab } from './tabs/Overview';
import { TeamTab } from './tabs/Team';

export function App() {
  const [filters, update] = useFilters();
  const meta = useMeta();
  return (
    <div className="flex min-h-screen flex-col">
      <Header filters={filters} update={update} meta={meta.data} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6">
        {filters.tab === 'overview' && <OverviewTab filters={filters} />}
        {filters.tab === 'marketing' && <MarketingTab filters={filters} />}
        {filters.tab === 'funnel' && <FunnelTab filters={filters} />}
        {filters.tab === 'finance' && <FinanceTab filters={filters} />}
        {filters.tab === 'team' && <TeamTab filters={filters} />}
      </main>
      <SyncPanel />
    </div>
  );
}
