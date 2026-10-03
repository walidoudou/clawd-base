import { create } from 'zustand';
import { stripWorkflowMarker } from '@dash/shared';
import type { Agent, DashConfig, EntityKind, FileChange, LogEntry, PatchBatch, Session, Snapshot, ToolEvent, Workflow } from '@dash/shared';
import { t } from './i18n/index.ts';

export type Selection = { kind: 'agent'; id: string } | { kind: 'workflow'; id: string } | null;
export type View = 'game' | 'list' | 'timeline' | 'files';

export interface Toast {
  id: number;
  level: LogEntry['level'];
  text: string;
  sessionId: string;
  agentId: string | null;
  at: number;
  /** Toasts with the same group arriving close together are merged. */
  group?: string;
  /** Clicking the toast switches to this session. */
  switchTo?: string;
  count?: number;
}

const LOG_RING = 400;

/**
 * Entities live in plain Maps (mutated in place for speed); `version` is bumped
 * at most once per animation frame so React re-renders are throttled.
 */
export const data = {
  sessions: new Map<string, Session>(),
  agents: new Map<string, Agent>(),
  tools: new Map<string, ToolEvent>(),
  files: new Map<string, FileChange>(),
  workflows: new Map<string, Workflow>(),
  /** Recent event log (all sessions), newest last. */
  logs: [] as LogEntry[],
};

interface DashState {
  version: number;
  connection: 'connecting' | 'open' | 'closed';
  sessionId: string | null;
  /** True once the user picked a session manually (stop auto-following the latest). */
  pinnedSession: boolean;
  selection: Selection;
  view: View;
  toasts: Toast[];
  journalOpen: boolean;
  /** Show finished agents that left the base (they stay in timeline/files/list either way). */
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  config: DashConfig;
  serverStartedAt: number;
  setConnection: (c: DashState['connection']) => void;
  selectSession: (id: string) => void;
  select: (s: Selection) => void;
  setView: (v: View) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setJournalOpen: (open: boolean) => void;
  setConfig: (c: DashConfig) => void;
}

export const useDash = create<DashState>((set) => ({
  version: 0,
  connection: 'connecting',
  sessionId: null,
  pinnedSession: false,
  selection: null,
  view: (() => {
    try {
      const v = localStorage.getItem('dash.view');
      return v === 'list' || v === 'timeline' || v === 'files' ? v : 'game';
    } catch {
      return 'game';
    }
  })(),
  config: { spriteSet: 'mole', locale: 'fr', version: '' },
  serverStartedAt: 0,
  toasts: [],
  showArchived: (() => {
    try {
      return localStorage.getItem('dash.archived') === '1';
    } catch {
      return false;
    }
  })(),
  setShowArchived: (showArchived) => {
    try {
      localStorage.setItem('dash.archived', showArchived ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ showArchived });
  },
  journalOpen: (() => {
    try {
      return localStorage.getItem('dash.journal') === '1';
    } catch {
      return false;
    }
  })(),
  setConnection: (connection) => set({ connection }),
  selectSession: (id) => set({ sessionId: id, pinnedSession: true, selection: null }),
  select: (selection) => set({ selection }),
  setView: (view) => {
    try {
      localStorage.setItem('dash.view', view);
    } catch {
      /* ignore */
    }
    set({ view });
  },
  setConfig: (config) => set({ config }),
  pushToast: (toast) =>
    set((st) => {
      // Group bursts of "new agent" toasts into one.
      const last = st.toasts[st.toasts.length - 1];
      if (toast.group && last?.group === toast.group && toast.at - last.at < 2500) {
        const merged = { ...last, text: `${last.text}, ${toast.text.replace(/^[^:]+: /, '')}`, at: toast.at, count: (last.count ?? 1) + 1 };
        return { toasts: [...st.toasts.slice(0, -1), merged] };
      }
      const id = ++toastSeq;
      const life = toast.level === 'error' || toast.level === 'warn' ? 9000 : 5000;
      window.setTimeout(() => useDash.getState().dismissToast(id), life);
      return { toasts: [...st.toasts, { ...toast, id }].slice(-4) };
    }),
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })),
  setJournalOpen: (journalOpen) => {
    try {
      localStorage.setItem('dash.journal', journalOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ journalOpen });
  },
}));

let toastSeq = 0;
/** Throttle repeated error toasts per agent. */
const lastErrorToast = new Map<string, number>();

const MAPS: Record<EntityKind, Map<string, unknown>> = {
  session: data.sessions,
  agent: data.agents,
  tool: data.tools,
  file: data.files,
  workflow: data.workflows,
};

let frameRequested = false;
function bump(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    const st = useDash.getState();
    // The guided demo pins its session; once it is over, auto-follow takes over again.
    const pinned = st.pinnedSession && !(st.sessionId && data.sessions.get(st.sessionId)?.narration?.done);
    const sessionId = pickSession(st.sessionId, pinned);
    // Following another session: a panel open on the previous one would show the wrong session.
    let selection = st.selection;
    if (sessionId !== st.sessionId && selection) {
      const owner = selection.kind === 'agent' ? data.agents.get(selection.id)?.sessionId : data.workflows.get(selection.id)?.sessionId;
      if (owner !== sessionId) selection = null;
    }
    useDash.setState({ version: st.version + 1, sessionId, pinnedSession: pinned, selection });
    updateTitle(sessionId);
  });
}

/** Sessions worth showing: has activity beyond a bare start/end. */
export function visibleSessions(): Session[] {
  const out: Session[] = [];
  for (const s of data.sessions.values()) {
    const main = data.agents.get(s.id);
    // Show sessions with activity, the guided demo from its first second, and the one on screen.
    if ((main && (main.turns > 0 || main.toolCount > 0 || main.usage.total > 0)) || s.narration || s.id === useDash.getState().sessionId) out.push(s);
  }
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** How long the session on screen keeps the focus after its last activity. */
const STICKY_MS = 120_000;

function pickSession(current: string | null, pinned: boolean): string | null {
  const cur = current ? data.sessions.get(current) : undefined;
  if (cur) {
    if (pinned) return current;
    // Stay on the current session while it is active: two busy sessions must not flip the view
    // back and forth. Activity elsewhere is announced with a toast instead.
    if (Date.now() - cur.lastActivityAt < STICKY_MS) return current;
  }
  return visibleSessions()[0]?.id ?? current ?? null;
}

export function applySnapshot(s: Snapshot): void {
  for (const m of Object.values(MAPS)) m.clear();
  for (const x of s.sessions) data.sessions.set(x.id, x);
  for (const x of s.agents) data.agents.set(x.id, x);
  for (const x of s.tools) data.tools.set(x.id, x);
  for (const x of s.files) data.files.set(x.id, x);
  for (const x of s.workflows) data.workflows.set(x.id, x);
  data.logs = s.logs.slice(-LOG_RING);
  knownWorkflows.clear();
  for (const w of s.workflows) knownWorkflows.add(w.id);
  useDash.setState({ serverStartedAt: s.serverStartedAt });
  bump();
}

const knownWorkflows = new Set<string>();

function agentName(id: string | null): string {
  const a = id ? data.agents.get(id) : undefined;
  if (!a) return t.agent;
  return a.kind === 'main' ? t.mainRoom : agentLabel(a);
}

const lastActivityToast = new Map<string, number>();

/** Turn notable log entries into toasts. Old entries (transcript catch-up at startup) are ignored. */
function toastsFor(logs: LogEntry[]): void {
  const st = useDash.getState();
  const now = Date.now();
  for (const l of logs) {
    if (now - l.at > 60_000) continue;
    if (l.sessionId !== st.sessionId) {
      // Activity in another session: offer to switch (at most once a minute per session).
      if (l.kind !== 'prompt' && l.kind !== 'agent.spawn' && l.kind !== 'attention') continue;
      if (l.sessionId.startsWith('sim-') && !l.sessionId.startsWith('sim-demo')) continue;
      if (now - (lastActivityToast.get(l.sessionId) ?? 0) < 60_000) continue;
      lastActivityToast.set(l.sessionId, now);
      const title = data.sessions.get(l.sessionId)?.title ?? l.sessionId.slice(0, 8);
      st.pushToast({ level: l.kind === 'attention' ? 'warn' : 'info', text: t.toast.elsewhere(title, l.summary), sessionId: l.sessionId, agentId: null, at: now, switchTo: l.sessionId });
      continue;
    }
    if (l.kind === 'attention') st.pushToast({ level: 'warn', text: t.toast.waiting(l.summary), sessionId: l.sessionId, agentId: l.agentId, at: l.at });
    else if (l.kind === 'agent.spawn') {
      const name = stripWorkflowMarker(l.summary.replace(/^[^—]+— /, ''));
      st.pushToast({ level: 'info', text: t.toast.spawn(name), sessionId: l.sessionId, agentId: l.agentId, at: Date.now(), group: 'spawn' });
    }
    else if (l.level === 'error') {
      const key = l.agentId ?? l.sessionId;
      if (Date.now() - (lastErrorToast.get(key) ?? 0) < 10_000) continue;
      lastErrorToast.set(key, Date.now());
      st.pushToast({ level: 'error', text: `${t.toast.error(agentName(l.agentId))} — ${l.summary}`, sessionId: l.sessionId, agentId: l.agentId, at: l.at });
    }
  }
}

export function applyPatch(b: PatchBatch): void {
  for (const c of b.changes) {
    if (c.op === 'upsert') MAPS[c.kind].set(c.data.id, c.data);
    else MAPS[c.kind].delete(c.id);
  }
  if (b.logs.length) {
    data.logs.push(...b.logs);
    if (data.logs.length > LOG_RING) data.logs.splice(0, data.logs.length - LOG_RING);
    toastsFor(b.logs);
  }
  const sid = useDash.getState().sessionId;
  for (const c of b.changes) {
    if (c.op === 'upsert' && c.kind === 'workflow' && !knownWorkflows.has(c.data.id)) {
      knownWorkflows.add(c.data.id);
      if (c.data.sessionId === sid) useDash.getState().pushToast({ level: 'success', text: t.toast.workflow(t.workflowName(c.data.name)), sessionId: c.data.sessionId, agentId: null, at: Date.now() });
    }
  }
  // A pending agent re-keyed to its real id: keep the panel open on the new id.
  const sel = useDash.getState().selection;
  if (sel?.kind === 'agent' && !data.agents.has(sel.id)) {
    const tu = sel.id.startsWith('t:') ? sel.id.slice(2) : null;
    const moved = tu ? [...data.agents.values()].find((a) => a.spawnToolUseId === tu) : undefined;
    useDash.setState({ selection: moved ? { kind: 'agent', id: moved.id } : null });
  }
  bump();
}

// ───────────── derived helpers ─────────────

export function sessionAgents(sessionId: string): Agent[] {
  const out: Agent[] = [];
  for (const a of data.agents.values()) if (a.sessionId === sessionId) out.push(a);
  return out.sort((a, b) => (a.kind === 'main' ? -1 : b.kind === 'main' ? 1 : a.startedAt - b.startedAt));
}

export function sessionWorkflows(sessionId: string): Workflow[] {
  const out: Workflow[] = [];
  for (const w of data.workflows.values()) if (w.sessionId === sessionId) out.push(w);
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function agentTools(agentId: string): ToolEvent[] {
  const out: ToolEvent[] = [];
  for (const t of data.tools.values()) if (t.agentId === agentId) out.push(t);
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function agentFileChanges(agentId: string): FileChange[] {
  const out: FileChange[] = [];
  for (const f of data.files.values()) if (f.agentId === agentId) out.push(f);
  return out.sort((a, b) => a.at - b.at);
}

export function isActive(a: Agent): boolean {
  return a.status === 'running' || a.status === 'starting';
}

export function workflowActive(w: Workflow): boolean {
  return w.steps.some((s) => s.agentIds.some((id) => {
    const a = data.agents.get(id);
    return a ? isActive(a) : false;
  }));
}

/** Index of the step currently running (first step with an active agent), or -1. */
export function activeStepIndex(w: Workflow): number {
  return w.steps.findIndex((s) => s.agentIds.some((id) => {
    const a = data.agents.get(id);
    return a ? isActive(a) : false;
  }));
}

/**
 * Seed for an agent's mascot. Uses the spawning tool_use id when known, so the look
 * does not change when a pending room (`t:<toolUseId>`) is re-keyed to the real agent id.
 */
export function mascotSeed(a: Agent): string {
  return a.kind === 'main' ? a.id : (a.spawnToolUseId ?? a.id);
}

/** Human label for an agent room/panel (workflow markers stripped). */
export function agentLabel(a: Agent): string {
  return stripWorkflowMarker(a.description) || a.type;
}

/** Browser tab title reflects activity: running agents and pending questions. */
function updateTitle(sessionId: string | null): void {
  if (!sessionId) {
    document.title = t.appName;
    return;
  }
  let running = 0;
  let waiting = false;
  for (const a of data.agents.values()) {
    if (a.sessionId !== sessionId) continue;
    if (isActive(a)) running++;
    if (a.waiting) waiting = true;
  }
  document.title = `${waiting ? '⚠ ' : ''}${running ? `▶${running} · ` : ''}${t.appName}`;
}

export function sessionLogs(sessionId: string, limit = 200): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = data.logs.length - 1; i >= 0 && out.length < limit; i--) {
    const l = data.logs[i] as LogEntry;
    if (l.sessionId === sessionId) out.push(l);
  }
  return out;
}

export function sessionFiles(sessionId: string): FileChange[] {
  const out: FileChange[] = [];
  for (const f of data.files.values()) if (f.sessionId === sessionId) out.push(f);
  return out;
}

export function sessionTools(sessionId: string): ToolEvent[] {
  const out: ToolEvent[] = [];
  for (const x of data.tools.values()) if (x.sessionId === sessionId) out.push(x);
  return out;
}

/** Finished sub-agents leave the base after a while (errors stay longer, for analysis). */
export const ARCHIVE_AFTER_MS = 90_000;
export const ARCHIVE_ERROR_AFTER_MS = 5 * 60_000;

/** After the guided demo, its agents leave about a minute later, one by one. */
const DEMO_ARCHIVE_AFTER_MS = 60_000;

export function isArchived(a: Agent, now: number): boolean {
  if (a.kind !== 'sub' || a.endedAt === null) return false;
  const n = data.sessions.get(a.sessionId)?.narration;
  if (n && a.status === 'done') {
    // Nothing leaves while the tour is talking about it (the base would reshuffle under the camera).
    if (!n.done) return false;
    return now - Math.max(a.endedAt, n.at) > DEMO_ARCHIVE_AFTER_MS + (a.startedAt % 8) * 2500;
  }
  if (a.status === 'done') return now - a.endedAt > ARCHIVE_AFTER_MS;
  if (a.status === 'error') return now - a.endedAt > ARCHIVE_ERROR_AFTER_MS;
  return false;
}
