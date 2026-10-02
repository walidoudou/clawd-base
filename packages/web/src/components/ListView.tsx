import { animationFor, type Agent } from '@dash/shared';
import { t, intlLocale } from '../i18n/index.ts';
import { agentLabel, data, mascotSeed, sessionAgents, sessionWorkflows, useDash } from '../state.ts';
import { basename, modelBadge, preview } from '../format.ts';
import { MascotCanvas } from './MascotCanvas.tsx';
import { TokenChips } from './TokenBreakdown.tsx';

function AgentCard({ a }: { a: Agent }) {
  const select = useDash((s) => s.select);
  const selected = useDash((s) => s.selection?.kind === 'agent' && s.selection.id === a.id);
  const recentFiles = Object.values(a.files).sort((x, y) => y.lastAt - x.lastAt).slice(0, 4);
  return (
    <button className={`card st-border-${a.status} ${selected ? 'selected' : ''}`} onClick={() => select({ kind: 'agent', id: a.id })}>
      <div className="card-top">
        <MascotCanvas id={mascotSeed(a)} canonical={a.kind === 'main'} anim={animationFor(a, Date.now(), a.endedAt)} scale={3} />
        <div className="card-head">
          <strong>{a.kind === 'main' ? t.mainRoom : agentLabel(a)}</strong>
          <span className="small muted">
            {a.kind === 'main' ? '' : `${a.type} · `}
            {modelBadge(a.model)} · <span className={`st-text-${a.status}`}>{t.statusLabel[a.status]}</span>
          </span>
          <span className="small">{a.waiting ? <span className="waiting-inline">⚠ {t.waitingShort}</span> : a.currentTool ? `▶ ${a.currentTool} ${a.currentToolInputPreview ?? ''}` : a.status === 'running' ? `… ${t.thinking}` : ''}</span>
          {a.todos.length > 0 && (
            <span className="small todo-inline">
              ☐ {a.todos.filter((x) => x.status === 'completed').length}/{a.todos.length} {a.todos.find((x) => x.status === 'in_progress')?.activeForm ?? ''}
            </span>
          )}
        </div>
      </div>
      {a.kind === 'sub' && a.prompt && <p className="small muted card-prompt">{preview(a.prompt)}</p>}
      <ul className="card-files">
        {recentFiles.map((f) => (
          <li key={f.path} className="small">
            {f.lastOp === 'read' ? '📖' : '✏️'} {basename(f.path)} {f.edits > 0 && <><span className="add">+{f.added}</span> <span className="del">-{f.removed}</span></>}
          </li>
        ))}
      </ul>
      {a.contextTokens > 0 && (
        <div className="card-ctx" title={`${t.context} ${a.contextTokens.toLocaleString(intlLocale)}`}>
          <span style={{ width: `${Math.min(100, (a.contextTokens / (data.sessions.get(a.sessionId)?.contextWindow ?? 200_000)) * 100)}%` }} />
        </div>
      )}
      <div className="card-bottom">
        <TokenChips usage={a.usage} />
        <span className="small"><span className="add">+{a.added}</span> <span className="del">-{a.removed}</span></span>
      </div>
    </button>
  );
}

/** Simple non-game layout (milestone M2) — also a fallback/accessible view. */
export function ListView() {
  useDash((s) => s.version);
  const sessionId = useDash((s) => s.sessionId);
  const select = useDash((s) => s.select);
  if (!sessionId) return <div className="empty">{t.noSession}</div>;
  const agents = sessionAgents(sessionId);
  const workflows = sessionWorkflows(sessionId);
  const inWf = new Set(workflows.flatMap((w) => w.steps.flatMap((s) => s.agentIds)));
  const main = agents.find((a) => a.kind === 'main');
  const loose = agents.filter((a) => a.kind === 'sub' && !inWf.has(a.id));
  return (
    <div className="list-view">
      {main && (
        <section>
          <h2 className="section-title">{t.mainRoom}</h2>
          <div className="card-grid">
            <AgentCard a={main} />
          </div>
        </section>
      )}
      {workflows.map((w) => (
        <section key={w.id} className="wf-section">
          <h2 className="section-title">
            <button className="link" onClick={() => select({ kind: 'workflow', id: w.id })}>
              <MascotCanvas id={w.id} chief scale={2} /> {t.workflowName(w.name)}
            </button>
            <span className="muted small"> · {t.source[w.source]}</span>
          </h2>
          {w.steps.map((st) => (
            <div key={st.index} className="wf-step">
              <div className="small muted">{t.step} {st.index}</div>
              <div className="card-grid">
                {st.agentIds.map((id) => {
                  const a = data.agents.get(id);
                  return a ? <AgentCard key={id} a={a} /> : null;
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
      {loose.length > 0 && (
        <section>
          <h2 className="section-title">{t.agents}</h2>
          <div className="card-grid">
            {[...loose].reverse().map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
