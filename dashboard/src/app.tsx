import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { Binoculars } from 'lucide-react';

import { CreatureDetail } from '@/components/CreatureDetail';
import { Overview } from '@/components/Overview';
import { RangerPanel } from '@/components/RangerPanel';
import { SettingsModal } from '@/components/SettingsModal';
import { ShareModal } from '@/components/ShareModal';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from '@/state';

function HealthBanner() {
  const health = useStore(s => s.health);
  if (health.status === 'healthy') return null;

  const issues = Object.entries(health.dependencies)
    .filter(([, d]) => d.status !== 'up')
    .map(([name, d]) => `${name}: ${d.error || 'down'}`)
    .join(' · ');

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-red-50 border-b-2 border-red-600 px-4 py-2.5 text-xs text-red-800 text-center">
      Orchestrator degraded — creature operations suspended.{' '}
      <span className="font-medium text-red-600">{issues}</span>
    </div>
  );
}

export function App() {
  const sseRef = useRef<EventSource | null>(null);
  const sel = useStore(s => s.selected);
  const sbOpen = useStore(s => s.sidebarOpen);
  const tab = useStore(s => s.selectedTab);
  const evLen = useStore(s => s.creatureEvents.length);
  const degraded = useStore(s => s.health.status !== 'healthy');
  const { refresh, loadNarration, loadRecentEvents, loadGenomes, loadModels, loadGlobalBudget, loadHealth, handleSSEEvent } = useStore();
  const [rangerOpen, setRangerOpen] = useState(false);

  const showSidebar = sel !== null || sbOpen;

  useEffect(() => {
    refresh()
      .then(() => Promise.all([loadRecentEvents(), loadNarration()]))
      .then(() => {});
    loadGenomes();
    loadModels();
    loadGlobalBudget();
    loadHealth();
    const interval = setInterval(refresh, 30000);

    const sse = new EventSource('/api/events');
    sse.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        handleSSEEvent(ev);
      } catch (err) {
        console.warn('[sse] failed to parse event:', e.data, err);
      }
    };
    sse.onerror = (() => {
      let lastRefresh = 0;
      return () => {
        const now = Date.now();
        if (now - lastRefresh > 5000) {
          lastRefresh = now;
          // EventSource auto-reconnects; refresh state to avoid stale dashboard
          refresh();
          loadHealth();
          loadRecentEvents();
        }
      };
    })();
    sseRef.current = sse;

    return () => {
      clearInterval(interval);
      sse.close();
    };
  }, []);

  useEffect(() => {
    if (sel && tab === 'log') {
      requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }, [evLen]);

  return (
    <TooltipProvider>
      <HealthBanner />
      <div className={`flex min-h-screen bg-bg text-text-primary text-[13px] font-sans ${degraded ? 'pt-10' : ''}`}>
        {showSidebar && <Sidebar />}
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* Ranger toggle */}
          <Button
            variant="ghost" size="icon-xs"
            className={`fixed top-3 right-3 z-50 ${rangerOpen ? 'text-accent-blue' : 'text-text-faint hover:text-text-secondary'}`}
            onClick={() => setRangerOpen(!rangerOpen)}
            title={rangerOpen ? 'Close ranger' : 'Open ranger'}
          >
            <Binoculars className="size-4" />
          </Button>
          {sel === null ? <Overview /> : <CreatureDetail />}
        </div>
        {rangerOpen && <RangerPanel onClose={() => setRangerOpen(false)} />}
        <ShareModal />
        <SettingsModal />
      </div>
    </TooltipProvider>
  );
}
