import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Agent, ToolEvent, Workflow } from '@dash/shared';
import { t } from '../i18n/index.ts';
import { agentLabel, data, isActive, mascotSeed, sessionAgents, sessionTools, sessionWorkflows, useDash } from '../state.ts';
import { formatDuration, formatTime, modelBadge } from '../format.ts';
import { CATEGORY_COLOR, toolCategory, toolDisplayName, type ToolCategory } from '../tools.ts';
import { MascotCanvas } from './MascotCanvas.tsx';

const LABEL_W = 230;
const ROW_H = 24;
const AXIS_H = 26;
const TICKS = [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 21600];

type Row = { type: 'agent'; agent: Agent; depth: number } | { type: 'workflow'; wf: Workflow };

function buildRows(sessionId: string): Row[] {
  const agents = sessionAgents(sessionId);
  const workflows = sessionWorkflows(sessionId);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const inWf = new Set(workflows.flatMap((w) => w.steps.flatMap((s) => s.agentIds)));
  const rows: Row[] = [];
  const main = agents.find((a) => a.kind === 'main');
  if (main) rows.push({ type: 'agent', agent: main, depth: 0 });
  // loose agents in tree order
  const loose = agents.filter((a) => a.kind === 'sub' && !inWf.has(a.id));
  const looseIds = new Set(loose.map((a) => a.id));
  const children = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of loose) {
    if (a.parentId && looseIds.has(a.parentId)) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
    else roots.push(a);
  }
  const visit = (a: Agent, depth: number) => {
    rows.push({ type: 'agent', agent: a, depth });
    for (const c of children.get(a.id) ?? []) visit(c, depth + 1);
  };
  // interleave workflows and loose agents by start time
  const items: Array<{ at: number; push: () => void }> = [
    ...roots.map((a) => ({ at: a.startedAt, push: () => visit(a, 1) })),
    ...workflows.map((w) => ({
      at: w.startedAt,
      push: () => {
        rows.push({ type: 'workflow', wf: w });
        for (const st of w.steps) for (const id of st.agentIds) {
          const a = byId.get(id);
          if (a) rows.push({ type: 'agent', agent: a, depth: 2 });
        }
      },
    })),
  ];
  items.sort((x, y) => x.at - y.at).forEach((i) => i.push());
  return rows;
}

function tickStep(pps: number): number {
  return TICKS.find((s) => s * pps >= 90) ?? TICKS[TICKS.length - 1] ?? 3600;
}

function fmtTick(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 ? String(sec % 60).padStart(2, '0') : ''}`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60) ? String(Math.floor((sec % 3600) / 60)).padStart(2, '0') : ''}`;
}

/** Gantt view of the session: one row per agent, tool calls as coloured bars. */
export function TimelineView() {
  useDash((s) => s.version);
  const sessionId = useDash((s) => s.sessionId);
  const select = useDash((s) => s.select);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [pps, setPps] = useState<number | null>(null); // px per second; null = fit
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // The chart area only exists once a session is shown (first render after a reload has none yet).
  const hasSession = sessionId !== null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [hasSession]);

  const session = sessionId ? data.sessions.get(sessionId) : undefined;
  const rows = useMemo(() => (sessionId ? buildRows(sessionId) : []), [sessionId, useDash.getState().version]);
  const toolsByAgent = useMemo(() => {
    const m = new Map<string, ToolEvent[]>();
    if (sessionId) for (const x of sessionTools(sessionId)) m.set(x.agentId, [...(m.get(x.agentId) ?? []), x]);
    return m;
  }, [sessionId, useDash.getState().version]);

  const anyActive = rows.some((r) => r.type === 'agent' && isActive(r.agent));
  const t0 = useMemo(() => {
    let min = session?.startedAt ?? now;
    for (const r of rows) if (r.type === 'agent') min = Math.min(min, r.agent.startedAt);
    return min;
  }, [rows, session, now]);
  const t1 = session && session.status !== 'active' && !anyActive ? Math.max(session.lastActivityAt, t0 + 1000) : now;
  const spanSec = Math.max(5, (t1 - t0) / 1000);
  const fitPps = Math.max(0.0005, (width - 40) / spanSec);
  const scale = pps ?? fitPps;
  const svgW = Math.max(width, Math.ceil(spanSec * scale) + 40);
  const svgH = AXIS_H + rows.length * ROW_H + 8;
  const x = (at: number) => ((at - t0) / 1000) * scale;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && live && pps !== null) el.scrollLeft = el.scrollWidth;
  }, [now, live, pps, svgW]);

  if (!sessionId) return <div className="empty">{t.noSession}</div>;
  const step = tickStep(scale);
  const ticks: number[] = [];
  for (let s = 0; s <= spanSec + step; s += step) ticks.push(s);
  const legend: Array<ToolCategory | 'error'> = ['read', 'edit', 'bash', 'agent', 'other', 'error'];

  return (
    <div className="timeline-view">
      <div className="tl-toolbar">
        <button onClick={() => setPps((scale || fitPps) * 2)} aria-label={t.zoomIn} title={t.zoomIn}>
          ＋
        </button>
        <button onClick={() => setPps((scale || fitPps) / 2)} aria-label={t.zoomOut} title={t.zoomOut}>
          －
        </button>
        <button className={pps === null ? 'on' : ''} onClick={() => setPps(null)}>
          {t.recenter}
        </button>
        <button className={live ? 'on' : ''} aria-pressed={live} onClick={() => setLive(!live)}>
          {t.follow}
        </button>
        <span className="tl-legend">
          {legend.map((c) => (
            <span key={c} className="tl-legend-item">
              <span className="tl-swatch" style={{ background: CATEGORY_COLOR[c] }} /> {t.legend[c]}
            </span>
          ))}
        </span>
      </div>
      <div className="tl-body">
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div style={{ height: AXIS_H }} />
          {rows.map((r) =>
            r.type === 'workflow' ? (
              <button key={`w${r.wf.id}`} className="tl-label tl-label-wf" style={{ height: ROW_H }} onClick={() => select({ kind: 'workflow', id: r.wf.id })}>
                ♛ {t.workflowName(r.wf.name)} <span className="muted small">· {r.wf.steps.length} {t.steps.toLowerCase()}</span>
              </button>
            ) : (
              <button key={r.agent.id} className={`tl-label st-text-${r.agent.status}`} style={{ height: ROW_H, paddingLeft: 6 + r.depth * 12 }} onClick={() => select({ kind: 'agent', id: r.agent.id })} title={r.agent.prompt.slice(0, 300)}>
                <MascotCanvas id={mascotSeed(r.agent)} canonical={r.agent.kind === 'main'} scale={1} />
                <span className="tl-name">{r.agent.kind === 'main' ? t.mainRoom : agentLabel(r.agent)}</span>
                <span className="tl-model muted">{modelBadge(r.agent.model)}</span>
              </button>
            ),
          )}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <svg width={svgW} height={svgH} className="tl-svg" shapeRendering="crispEdges">
            {/* axis */}
            {ticks.map((s) => (
              <g key={s}>
                <line x1={s * scale} x2={s * scale} y1={AXIS_H - 6} y2={svgH} stroke="#2a2436" />
                <text x={s * scale + 3} y={14} className="tl-tick">
                  {fmtTick(s)}
                </text>
              </g>
            ))}
            <text x={2} y={24} className="tl-tick muted">
              {formatTime(t0)}
            </text>
            {rows.map((r, i) => {
              const y = AXIS_H + i * ROW_H;
              if (r.type === 'workflow') {
                return (
                  <g key={`w${r.wf.id}`}>
                    <rect x={0} y={y} width={svgW} height={ROW_H} fill="rgba(242,193,78,0.06)" />
                    {r.wf.steps.map((st) => (
                      <g key={st.index}>
                        <line x1={x(st.startedAt)} x2={x(st.startedAt)} y1={y} y2={y + ROW_H * (st.agentIds.length + 1) + 200} stroke="#f2c14e" strokeDasharray="3 3" opacity={0.5} />
                        <text x={x(st.startedAt) + 3} y={y + 15} className="tl-step">
                          {t.step} {st.index}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              }
              const a = r.agent;
              const end = a.endedAt ?? (isActive(a) ? now : a.lastActivityAt);
              const tools = toolsByAgent.get(a.id) ?? [];
              return (
                <g key={a.id}>
                  <rect x={0} y={y + ROW_H - 1} width={svgW} height={1} fill="#1d1824" />
                  <rect x={x(a.startedAt)} y={y + 9} width={Math.max(2, x(end) - x(a.startedAt))} height={6} fill={a.status === 'error' ? '#4a1f28' : '#2e2840'} />
                  {tools.map((tool) => {
                    const cat = tool.status === 'error' ? 'error' : toolCategory(tool.name);
                    const tEnd = tool.endedAt ?? (tool.status === 'running' ? now : tool.startedAt + 500);
                    const w = Math.max(2, x(tEnd) - x(tool.startedAt));
                    return (
                      <rect
                        key={tool.id}
                        x={x(tool.startedAt)}
                        y={y + 5}
                        width={w}
                        height={14}
                        fill={CATEGORY_COLOR[cat]}
                        opacity={tool.status === 'running' ? 1 : 0.85}
                        className="tl-bar"
                        onClick={() => select({ kind: 'agent', id: a.id })}
                      >
                        <title>
                          {`${toolDisplayName(tool.name)} — ${formatTime(tool.startedAt)} · ${tool.durationMs !== null ? formatDuration(tool.durationMs) : '…'}${tool.filePath ? `\n${tool.filePath}` : ''}${tool.error ? `\n${tool.error.slice(0, 200)}` : ''}`}
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
            <line x1={x(now)} x2={x(now)} y1={AXIS_H - 8} y2={svgH} stroke="#ff6b6b" strokeWidth={1} opacity={anyActive ? 0.9 : 0.3} />
          </svg>
        </div>
      </div>
    </div>
  );
}
