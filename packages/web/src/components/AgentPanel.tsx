import { useEffect, useMemo, useRef, useState } from 'react';
import { animationFor, sharesList, type Agent, type FileChange, type Message, type Session, type ToolEvent } from '@dash/shared';
import { t } from '../i18n/index.ts';
import { agentFileChanges, agentLabel, agentTools, conversation, data, mascotSeed, useDash } from '../state.ts';
import { basename, formatDuration, formatTime, formatTokens, modelBadge } from '../format.ts';
import { MascotCanvas } from './MascotCanvas.tsx';
import { TokenBreakdown } from './TokenBreakdown.tsx';
import { DiffView } from './DiffView.tsx';
import { ContextGauge } from './Gauges.tsx';
import { CATEGORY_COLOR, toolCategory, toolDisplayName } from '../tools.ts';

function StatusPill({ status }: { status: Agent['status'] }) {
  return <span className={`pill st-${status}`}>{t.statusLabel[status]}</span>;
}

const ROLE_ICON: Record<Message['role'], string> = { user: '▸', assistant: '◂', task: '✓' };

/** Live conversation: what was sent, received, queued while Claude worked, and tasks done. */
function Conversation({ agent }: { agent: Agent }) {
  const msgs = conversation(agent.sessionId, agent.id).slice(-80);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const last = msgs[msgs.length - 1];
  // Follow new messages, unless the user scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state]);
  return (
    <section>
      <h3>
        {t.conversation} <span className="muted small">({msgs.length})</span>
      </h3>
      {msgs.length === 0 ? (
        <p className="muted small">{t.noMessages}</p>
      ) : (
        <ol
          className="convo"
          ref={list}
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {msgs.map((m) => (
            <li key={m.id} className={`convo-msg convo-${m.role} convo-${m.state}`}>
              <div className="convo-meta">
                <span aria-hidden>{ROLE_ICON[m.role]}</span> <strong>{t.msgRole[m.role]}</strong> <span className="muted">{formatTime(m.at)}</span>
                {m.state !== 'sent' && <span className={`convo-badge convo-badge-${m.state}`}>{m.midTurn && m.state === 'delivered' ? t.midTurn : t.msgState[m.state]}</span>}
              </div>
              <div className="convo-text">{m.text}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function toolSummary(tl: ToolEvent): string {
  const i = tl.input;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : null);
  return s('file_path') ? basename(s('file_path') as string) : (s('command') ?? s('pattern') ?? s('description') ?? s('query') ?? s('url') ?? '');
}

function ToolRow({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const dur = tool.durationMs !== null ? formatDuration(tool.durationMs) : tool.endedAt ? formatDuration(tool.endedAt - tool.startedAt) : '…';
  const color = CATEGORY_COLOR[tool.status === 'error' ? 'error' : toolCategory(tool.name)];
  return (
    <li className={`tool-row ts-${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-time">{formatTime(tool.startedAt)}</span>
        <span className="tool-dot" style={{ background: color }} aria-hidden />
        <span className="tool-name">{toolDisplayName(tool.name)}</span>
        <span className="tool-sum">{toolSummary(tool)}</span>
        <span className="tool-dur">
          {tool.interrupted ? `${t.interrupted} · ` : ''}
          {dur}
        </span>
      </button>
      {open && (
        <div className="tool-body">
          <pre className="code-block">{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.error && <pre className="code-block err">{tool.error}</pre>}
          {tool.output && <pre className="code-block">{tool.output}</pre>}
        </div>
      )}
    </li>
  );
}

function ToolStats({ tools }: { tools: ToolEvent[] }) {
  const stats = useMemo(() => {
    const m = new Map<string, { n: number; ms: number; errors: number; color: string }>();
    for (const x of tools) {
      const k = toolDisplayName(x.name);
      const e = m.get(k) ?? { n: 0, ms: 0, errors: 0, color: CATEGORY_COLOR[toolCategory(x.name)] };
      e.n++;
      e.ms += x.durationMs ?? 0;
      if (x.status === 'error') e.errors++;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [tools]);
  if (!stats.length) return null;
  const max = Math.max(...stats.map(([, v]) => v.n));
  return (
    <table className="stats-table">
      <tbody>
        {stats.slice(0, 12).map(([name, v]) => (
          <tr key={name}>
            <td className="stats-name">{name}</td>
            <td className="stats-bar-cell">
              <span className="stats-bar" style={{ width: `${(v.n / max) * 100}%`, background: v.color }} />
            </td>
            <td className="num">{v.n}</td>
            <td className="num muted">{formatDuration(v.ms)}</td>
            <td className="num del">{v.errors ? `${v.errors}✖` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const GROUPS = ['skills', 'agents', 'plugins', 'mcpServers'] as const;
const GROUP_COLOR: Record<(typeof GROUPS)[number], string> = { skills: CATEGORY_COLOR.edit, agents: CATEGORY_COLOR.agent, plugins: CATEGORY_COLOR.other, mcpServers: CATEGORY_COLOR.bash };

/** What the session's usage went to, like Claude Code's /usage: skills, sub-agents, plugins, MCP servers. */
function Consumption({ session }: { session: Session }) {
  const sh = session.usageShares;
  const ctx = session.contextUsage;
  if (sh.total <= 0 && !ctx) return null;
  const pct = (v: number) => Math.round((v / sh.total) * 100);
  const behaviors = [
    [pct(sh.longContext), t.usageLongCtx],
    [pct(sh.subagents), t.usageSubagents],
    [pct(sh.cacheMiss), t.usageCacheMiss],
  ] as const;
  const groups = GROUPS.map((g) => [g, sharesList(sh[g], sh.total)] as const).filter(([, list]) => list.length > 0);
  return (
    <section>
      <h3 title={t.consumptionHint}>
        {t.consumption} <span className="muted small">ⓘ</span>
      </h3>
      {sh.total > 0 && (
        <>
          <ul className="usage-behaviors small">
            {behaviors.filter(([p]) => p > 0).map(([p, label]) => (
              <li key={label(t.pct(p))}>{label(t.pct(p))}</li>
            ))}
          </ul>
          {groups.length ? (
            <table className="stats-table consumers">
              {groups.map(([g, list]) => (
                <tbody key={g}>
                  <tr className="usage-group">
                    <th>{t.usageGroups[g]}</th>
                    <th />
                    <th className="num muted small">{t.pctUsage}</th>
                  </tr>
                  {list.slice(0, 8).map((x) => (
                    <tr key={x.name}>
                      <td className="stats-name" title={x.name}>{g === 'skills' ? `/${x.name}` : x.name}</td>
                      <td className="stats-bar-cell">
                        <span className="stats-bar" style={{ width: `${x.pct}%`, background: GROUP_COLOR[g] }} />
                      </td>
                      <td className="num">{t.pct(x.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          ) : (
            <p className="muted small">{t.noAttribution}</p>
          )}
        </>
      )}
      {ctx ? (
        <>
          <h4 className="small muted">{t.contextAt(formatTime(ctx.at))}</h4>
          <table className="stats-table">
            <tbody>
              {[...ctx.categories].sort((a, b) => b.tokens - a.tokens).map((c) => (
                <tr key={c.name}>
                  <td className="stats-name">{t.ctxCategory[c.name] ?? c.name}</td>
                  <td className="stats-bar-cell">
                    <span className="stats-bar" style={{ width: `${(c.tokens / (ctx.total || 1)) * 100}%`, background: CATEGORY_COLOR.other }} />
                  </td>
                  <td className="num">{formatTokens(c.tokens)}</td>
                  <td className="num muted">{((c.tokens / ctx.window) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted small">{t.contextTip}</p>
      )}
    </section>
  );
}

function Todos({ agent }: { agent: Agent }) {
  if (!agent.todos.length) return null;
  const done = agent.todos.filter((x) => x.status === 'completed').length;
  return (
    <section>
      <h3>
        {t.todos} <span className="muted small">({done}/{agent.todos.length})</span>
      </h3>
      <ul className="todo-list">
        {agent.todos.map((td, i) => (
          <li key={i} className={`todo todo-${td.status}`}>
            <span className="todo-box" aria-hidden>
              {td.status === 'completed' ? '☑' : td.status === 'in_progress' ? '▶' : '☐'}
            </span>
            {td.status === 'in_progress' && td.activeForm ? td.activeForm : td.content}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SubAgents({ agent }: { agent: Agent }) {
  const select = useDash((s) => s.select);
  const children = [...data.agents.values()].filter((a) => a.parentId === agent.id && a.id !== agent.id).sort((a, b) => a.startedAt - b.startedAt);
  if (!children.length) return null;
  return (
    <section>
      <h3>
        {t.subAgents} <span className="muted small">({children.length})</span>
      </h3>
      <ul className="sub-list">
        {children.map((c) => (
          <li key={c.id}>
            <button className="agent-chip" onClick={() => select({ kind: 'agent', id: c.id })}>
              <MascotCanvas id={mascotSeed(c)} anim={animationFor(c, Date.now(), c.endedAt)} scale={2} />
              <span className="agent-chip-text">
                <strong>{agentLabel(c)}</strong>
                <span className="small muted">
                  {c.type} · {modelBadge(c.model)} · <span className={`st-text-${c.status}`}>{t.statusLabel[c.status]}</span> · Σ{(c.usage.total / 1000).toFixed(0)}k · <span className="add">+{c.added}</span>{' '}
                  <span className="del">-{c.removed}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FileBlock({ path, changes }: { path: string; changes: FileChange[] }) {
  const [open, setOpen] = useState(false);
  const edits = changes.filter((c) => c.operation !== 'read');
  const added = edits.reduce((s, c) => s + c.added, 0);
  const removed = edits.reduce((s, c) => s + c.removed, 0);
  const ops = [...new Set(changes.map((c) => t.op[c.operation]))].join(', ');
  return (
    <li className="file-block">
      <button className="file-head" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!edits.length} title={path}>
        <span className="file-name">{basename(path)}</span>
        <span className="file-ops muted small">{ops}</span>
        {edits.length > 0 && (
          <span className="file-counts">
            <span className="add">+{added}</span> <span className="del">-{removed}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="file-diffs">
          <div className="muted small path">{path}</div>
          {edits.map((c) => (
            <div key={c.id} className="file-change">
              <div className="small muted">
                {formatTime(c.at)} · {t.op[c.operation]} · <span className="add">+{c.added}</span> <span className="del">-{c.removed}</span>
              </div>
              <DiffView change={c} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function AgentPanel({ agent }: { agent: Agent }) {
  useDash((s) => s.version);
  const select = useDash((s) => s.select);
  const tools = agentTools(agent.id);
  const changes = agentFileChanges(agent.id);
  const byFile = useMemo(() => {
    const m = new Map<string, FileChange[]>();
    for (const c of changes) m.set(c.path, [...(m.get(c.path) ?? []), c]);
    return [...m.entries()].sort((a, b) => Math.max(...b[1].map((c) => c.at)) - Math.max(...a[1].map((c) => c.at)));
  }, [changes]);
  const parent = agent.parentId ? data.agents.get(agent.parentId) : undefined;
  const wf = agent.workflowId ? data.workflows.get(agent.workflowId) : undefined;
  const now = Date.now();
  const session = data.sessions.get(agent.sessionId);
  const title = agent.kind === 'main' ? (session?.title ?? t.mainRoom) : agentLabel(agent);
  // The main agent never "ends" on its own (it can always resume): it ends with its session.
  const endedAt = agent.endedAt ?? (agent.kind === 'main' ? (session?.endedAt ?? null) : null);

  return (
    <div className="panel-content">
      <header className="panel-header">
        <MascotCanvas id={mascotSeed(agent)} canonical={agent.kind === 'main'} anim={animationFor(agent, now, agent.endedAt)} scale={4} />
        <div className="panel-title">
          <h2>{title}</h2>
          <div className="meta-row">
            <StatusPill status={agent.status} />
            <span className="badge">{modelBadge(agent.model)}</span>
            <span className="badge ghost">{agent.kind === 'main' ? t.mainRoom : agent.type}</span>
            {agent.currentTool && <span className="badge tool">{agent.currentTool} {agent.currentToolInputPreview ?? ''}</span>}
          </div>
          <div className="meta-row small muted">
            {t.started} {formatTime(agent.startedAt)}
            {endedAt ? ` · ${t.ended} ${formatTime(endedAt)} · ${formatDuration(endedAt - agent.startedAt)}` : ` · ${formatDuration(now - agent.startedAt)}`}
            {' · '}
            <span className="add">+{agent.added}</span> <span className="del">-{agent.removed}</span>
          </div>
          <div className="meta-row small">
            {parent && parent.id !== agent.id && (
              <button className="link" onClick={() => select({ kind: 'agent', id: parent.id })}>
                {t.parent}: {parent.kind === 'main' ? t.mainRoom : agentLabel(parent)}
              </button>
            )}
            {wf && (
              <button className="link" onClick={() => select({ kind: 'workflow', id: wf.id })}>
                {t.workflowName(wf.name)} · {t.step} {agent.stepIndex}
              </button>
            )}
          </div>
        </div>
      </header>

      {agent.waiting && (
        <div className="waiting-banner" role="alert">
          ⚠ {t.toast.waiting(agent.waiting)}
        </div>
      )}
      {agent.liveText && (Date.now() - agent.liveTextAt < 15000 || !agent.liveTextFinal) && (
        <section>
          <h3>
            {t.live} {!agent.liveTextFinal && <span className="live-dot" aria-hidden />}
          </h3>
          <pre className="prompt-block live-block">{agent.liveText}</pre>
        </section>
      )}
      <Conversation agent={agent} />
      <Todos agent={agent} />
      {agent.prompt && (
        <section>
          <h3>{t.prompt}</h3>
          <pre className="prompt-block">{agent.prompt}</pre>
        </section>
      )}
      {agent.lastMessage && !conversation(agent.sessionId, agent.id).some((m) => m.role === 'assistant') && (
        <section>
          <h3>{t.lastMessage}</h3>
          <pre className="prompt-block muted">{agent.lastMessage}</pre>
        </section>
      )}

      <section>
        <h3>{t.tokenBreakdown}</h3>
        <TokenBreakdown usage={agent.usage} />
        {agent.contextTokens > 0 && <ContextGauge used={agent.contextTokens} window={agent.contextWindow || (data.sessions.get(agent.sessionId)?.contextWindow ?? 200_000)} compactions={agent.compactions} wide />}
      </section>

      {agent.kind === 'main' && session && <Consumption session={session} />}
      <SubAgents agent={agent} />
      {agent.kind === 'main' && <SessionTasks sessionId={agent.sessionId} />}

      {tools.length > 0 && (
        <section>
          <h3>{t.toolStats}</h3>
          <ToolStats tools={tools} />
        </section>
      )}

      <section>
        <h3>
          {t.files} <span className="muted small">({byFile.length})</span>
        </h3>
        {byFile.length ? (
          <ul className="file-list">
            {byFile.map(([path, cs]) => (
              <FileBlock key={path} path={path} changes={cs} />
            ))}
          </ul>
        ) : (
          <p className="muted small">{t.noFiles}</p>
        )}
      </section>

      <section>
        <h3>
          {t.timeline} <span className="muted small">({tools.length})</span>
        </h3>
        {tools.length ? (
          <ol className="tool-list">
            {tools
              .slice(-300)
              .reverse()
              .map((tl) => (
                <ToolRow key={tl.id} tool={tl} />
              ))}
          </ol>
        ) : (
          <p className="muted small">{t.noTools}</p>
        )}
      </section>
    </div>
  );
}

function SessionTasks({ sessionId }: { sessionId: string }) {
  const tasks = data.sessions.get(sessionId)?.tasks ?? [];
  if (!tasks.length) return null;
  return (
    <section>
      <h3>
        {t.tasks} <span className="muted small">({tasks.filter((x) => x.status === 'completed').length}/{tasks.length})</span>
      </h3>
      <ul className="todo-list">
        {tasks.map((x) => (
          <li key={x.id} className={`todo todo-${x.status === 'completed' ? 'completed' : 'pending'}`}>
            <span className="todo-box" aria-hidden>
              {x.status === 'completed' ? '☑' : '☐'}
            </span>
            {x.subject}
          </li>
        ))}
      </ul>
    </section>
  );
}

