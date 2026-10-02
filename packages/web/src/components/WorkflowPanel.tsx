import { sumUsage, type Workflow } from '@dash/shared';
import { t } from '../i18n/index.ts';
import { activeStepIndex, agentLabel, data, mascotSeed, useDash } from '../state.ts';
import { formatDuration, formatTime, formatTokens, modelBadge, preview } from '../format.ts';
import { MascotCanvas } from './MascotCanvas.tsx';
import { TokenBreakdown } from './TokenBreakdown.tsx';
import { animationFor } from '@dash/shared';

/** Duration (first start → last end), tokens and diff of a step. */
function stepSummary(ids: string[], now: number): string {
  const as = ids.map((id) => data.agents.get(id)).filter((a) => !!a);
  if (!as.length) return '';
  const start = Math.min(...as.map((a) => a.startedAt));
  const end = Math.max(...as.map((a) => a.endedAt ?? (a.status === 'done' || a.status === 'error' ? a.lastActivityAt : now)));
  const tokens = as.reduce((s, a) => s + a.usage.total, 0);
  const added = as.reduce((s, a) => s + a.added, 0);
  const removed = as.reduce((s, a) => s + a.removed, 0);
  return `${formatDuration(end - start)} · Σ${formatTokens(tokens)} · +${added}/-${removed}`;
}

export function WorkflowPanel({ workflow }: { workflow: Workflow }) {
  useDash((s) => s.version);
  const select = useDash((s) => s.select);
  const agents = workflow.steps.flatMap((s) => s.agentIds.map((id) => data.agents.get(id))).filter((a) => !!a);
  const usage = sumUsage(agents.map((a) => a.usage));
  const added = agents.reduce((s, a) => s + a.added, 0);
  const removed = agents.reduce((s, a) => s + a.removed, 0);
  const active = activeStepIndex(workflow);
  const now = Date.now();
  const done = agents.length > 0 && agents.every((a) => a.status === 'done' || a.status === 'error');
  const owner = data.agents.get(workflow.ownerAgentId);

  return (
    <div className="panel-content">
      <header className="panel-header">
        <MascotCanvas id={workflow.id} chief anim={active >= 0 ? 'think' : done ? 'celebrate' : 'idle'} scale={4} />
        <div className="panel-title">
          <h2>{t.workflowName(workflow.name)}</h2>
          <div className="meta-row">
            <span className={`pill ${active >= 0 ? 'st-running' : done ? 'st-done' : 'st-idle'}`}>
              {active >= 0 ? `${t.step} ${workflow.steps[active]?.index} — ${t.statusLabel.running}` : done ? t.statusLabel.done : t.statusLabel.idle}
            </span>
            <span className="badge ghost">{t.source[workflow.source]}</span>
          </div>
          <div className="meta-row small muted">
            {t.started} {formatTime(workflow.startedAt)} · {workflow.steps.length} {t.steps.toLowerCase()} · {agents.length} {t.agents.toLowerCase()} · <span className="add">+{added}</span>{' '}
            <span className="del">-{removed}</span>
          </div>
          {owner && (
            <div className="meta-row small">
              <button className="link" onClick={() => select({ kind: 'agent', id: owner.id })}>
                {t.chief}: {owner.kind === 'main' ? t.mainRoom : agentLabel(owner)}
              </button>
            </div>
          )}
        </div>
      </header>

      <section>
        <h3>{t.tokenBreakdown}</h3>
        <TokenBreakdown usage={usage} />
      </section>

      <section>
        <h3>{t.steps}</h3>
        <ol className="step-list">
          {workflow.steps.map((st, i) => (
            <li key={st.index} className={`step ${i === active ? 'step-active' : ''}`}>
              <div className="step-head">
                {t.step} {st.index} <span className="muted small">· {formatTime(st.startedAt)} · {t.agentCount(st.agentIds.length)} · {stepSummary(st.agentIds, now)}</span>
              </div>
              <ul className="step-agents">
                {st.agentIds.map((id) => {
                  const a = data.agents.get(id);
                  if (!a) return null;
                  return (
                    <li key={id}>
                      <button className="agent-chip" onClick={() => select({ kind: 'agent', id })}>
                        <MascotCanvas id={mascotSeed(a)} anim={animationFor(a, now, a.endedAt)} scale={2} />
                        <span className="agent-chip-text">
                          <strong>{agentLabel(a)}</strong>
                          <span className="small muted">
                            {a.type} · {modelBadge(a.model)} · {t.statusLabel[a.status]} · <span className="add">+{a.added}</span> <span className="del">-{a.removed}</span>
                          </span>
                          <span className="small muted">{preview(a.prompt, 90)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
