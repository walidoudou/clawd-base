import { useEffect, useState } from 'react';
import { sumUsage } from '@dash/shared';
import { t, intlLocale, locale, setLocale } from '../i18n/index.ts';
import { data, isActive, sessionAgents, sessionWorkflows, useDash, visibleSessions, workflowActive } from '../state.ts';
import { formatDuration, formatTokens, modelBadge } from '../format.ts';
import { MascotCanvas } from './MascotCanvas.tsx';
import { ContextGauge, Sparkline } from './Gauges.tsx';
import type { View } from '../state.ts';
import { startDemo } from './DemoOverlay.tsx';

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function Hud() {
  useDash((s) => s.version);
  const now = useNow();
  const { sessionId, connection, view, setView, selectSession } = useDash();
  const session = sessionId ? data.sessions.get(sessionId) : undefined;
  const agents = session ? sessionAgents(session.id) : [];
  const usage = sumUsage(agents.map((a) => a.usage));
  const activeAgents = agents.filter((a) => a.kind === 'sub' && isActive(a)).length;
  const workflows = session ? sessionWorkflows(session.id) : [];
  const activeWf = workflows.filter(workflowActive).length;
  const sessions = visibleSessions();
  const end = session?.endedAt ?? (session?.status === 'active' ? now : session?.lastActivityAt ?? now);
  const main = session ? data.agents.get(session.id) : undefined;
  const views: Array<[View, string]> = [
    ['game', t.viewGame],
    ['list', t.viewList],
    ['timeline', t.viewTimeline],
    ['files', t.viewFiles],
  ];

  return (
    <header className="hud" role="banner">
      <div className="hud-brand">
        <MascotCanvas id="clawd-base" canonical scale={2} />
        <span className="hud-title">{t.appName}</span>
      </div>
      <div className="hud-session">
        <label className="sr-only" htmlFor="session-select">{t.session}</label>
        <select id="session-select" value={sessionId ?? ''} onChange={(e) => selectSession(e.target.value)}>
          {sessions.length === 0 && <option value="">—</option>}
          {sessions.map((s) => {
            let subs = 0;
            let running = 0;
            for (const a of data.agents.values()) {
              if (a.sessionId !== s.id || a.kind !== 'sub') continue;
              subs++;
              if (isActive(a)) running++;
            }
            const time = new Date(s.lastActivityAt || s.startedAt).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
            return (
              <option key={s.id} value={s.id}>
                {s.status === 'active' ? '● ' : '○ '}
                {s.title} {s.project && s.project !== s.title ? `· ${s.project} ` : ''}— {time}
                {subs ? ` · ${running ? `${running}/` : ''}${subs} agent${subs > 1 ? 's' : ''}` : ''}
              </option>
            );
          })}
        </select>
        {session && <span className={`pill ss-${session.status}`}>{t.sessionStatus[session.status]}</span>}
        {session?.model && <span className="badge">{modelBadge(session.model)}</span>}
      </div>
      <div className="hud-stats">
        <div className="stat" title={t.runningTime}>
          <span className="stat-label">⏱ {t.runningTime}</span>
          <span className="stat-value">{session ? formatDuration(end - session.startedAt) : '—'}</span>
        </div>
        <div className="stat tk-in" title={usage.input.toLocaleString(intlLocale)}>
          <span className="stat-label">{t.tokIn}</span>
          <span className="stat-value">{formatTokens(usage.input)}</span>
        </div>
        <div className="stat tk-out" title={usage.output.toLocaleString(intlLocale)}>
          <span className="stat-label">{t.tokOut}</span>
          <span className="stat-value">{formatTokens(usage.output)}</span>
        </div>
        <div className="stat tk-cr" title={`${t.tokCacheCreate} ${usage.cacheCreate.toLocaleString(intlLocale)} · ${t.tokCacheRead} ${usage.cacheRead.toLocaleString(intlLocale)}`}>
          <span className="stat-label">cache</span>
          <span className="stat-value">{formatTokens(usage.cacheCreate + usage.cacheRead)}</span>
        </div>
        <div className="stat tk-tot" title={usage.total.toLocaleString(intlLocale)}>
          <span className="stat-label">{t.tokTotal}</span>
          <span className="stat-value">{formatTokens(usage.total)}</span>
        </div>
        {session?.totalCostUSD != null && (
          <div className="stat" title={t.cost}>
            <span className="stat-label">{t.cost}</span>
            <span className="stat-value">${session.totalCostUSD.toFixed(2)}</span>
          </div>
        )}
        {session && (
          <div className="stat stat-wide">
            <span className="stat-label">{t.tokensPerMin}</span>
            <Sparkline start={session.usageTimeline.start} buckets={session.usageTimeline.buckets} now={now} />
          </div>
        )}
        {main && main.contextTokens > 0 && session && (
          <div className="stat stat-wide">
            <span className="stat-label">{t.context}</span>
            <ContextGauge used={main.contextTokens} window={session.contextWindow} compactions={main.compactions} />
          </div>
        )}
        <div className="stat">
          <span className="stat-label">{t.activeAgents}</span>
          <span className="stat-value">{activeAgents}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.activeWorkflows}</span>
          <span className="stat-value">{activeWf}</span>
        </div>
      </div>
      <div className="hud-right">
        <button className="demo-button" onClick={() => void startDemo()} title={t.demo.buttonTitle}>
          {t.demo.button}
        </button>
        <div className="view-toggle" role="group">
          {views.map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} aria-pressed={view === v}>
              {label}
            </button>
          ))}
        </div>
        <span className={`conn conn-${connection}`} title={connection === 'open' ? t.connected : connection === 'connecting' ? t.connecting : t.disconnected}>
          ● {connection === 'open' ? t.connected : t.disconnected}
        </span>
        <button className="lang-button" onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')} title={t.languageSwitchTitle} aria-label={t.languageSwitchTitle}>
          {t.languageSwitch}
        </button>
        <a className="small muted" href="/debug" target="_blank" rel="noreferrer">{t.debug}</a>
      </div>
    </header>
  );
}
