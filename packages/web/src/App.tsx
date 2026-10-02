import { lazy, Suspense, useEffect } from 'react';
import { t } from './i18n/index.ts';
import { data, useDash } from './state.ts';
import { connect } from './connection.ts';
import { Hud } from './components/Hud.tsx';
import { ListView } from './components/ListView.tsx';
import { AgentPanel } from './components/AgentPanel.tsx';
import { WorkflowPanel } from './components/WorkflowPanel.tsx';
import { TimelineView } from './components/TimelineView.tsx';
import { FilesView } from './components/FilesView.tsx';
import { Journal } from './components/Journal.tsx';
import { Toasts } from './components/Toasts.tsx';
import { DemoOverlay } from './components/DemoOverlay.tsx';

const GameView = lazy(() => import('./scene/GameView.tsx'));

function SidePanel() {
  useDash((s) => s.version);
  const selection = useDash((s) => s.selection);
  const select = useDash((s) => s.select);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);
  if (!selection) return null;
  const agent = selection.kind === 'agent' ? data.agents.get(selection.id) : undefined;
  const workflow = selection.kind === 'workflow' ? data.workflows.get(selection.id) : undefined;
  if (!agent && !workflow) return null;
  return (
    <aside className="side-panel" aria-label={agent ? t.agent : t.workflow}>
      <button className="close" onClick={() => select(null)} aria-label={t.close} title={`${t.close} (Échap)`}>
        ✕
      </button>
      {agent && <AgentPanel key={agent.id} agent={agent} />}
      {workflow && <WorkflowPanel key={workflow.id} workflow={workflow} />}
    </aside>
  );
}

export function App() {
  const view = useDash((s) => s.view);
  const connection = useDash((s) => s.connection);
  useEffect(() => connect(), []);
  useEffect(() => {
    // Shortcuts: 1-4 switch views, J toggles the journal (ignored while typing).
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return;
      const st = useDash.getState();
      const views = ['game', 'list', 'timeline', 'files'] as const;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < views.length) st.setView(views[idx] as (typeof views)[number]);
      else if (e.key === 'j' || e.key === 'J') st.setJournalOpen(!st.journalOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app">
      <Hud />
      <main className="main-area">
        {connection === 'closed' && <div className="banner">{t.disconnected}</div>}
        {view === 'game' && (
          <Suspense fallback={<div className="empty">{t.connecting}</div>}>
            <GameView />
          </Suspense>
        )}
        {view === 'list' && <ListView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'files' && <FilesView />}
        <Journal />
        <Toasts />
        <DemoOverlay />
        <SidePanel />
      </main>
    </div>
  );
}
