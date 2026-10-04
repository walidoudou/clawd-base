import type { NormalizedEvent } from './events.ts';
import type { Agent, FileChange, Message, Session, TodoItem, ToolEvent, Workflow } from './types.ts';
import { EMPTY_USAGE } from './types.ts';
import type { EntityKind, EntityMap, LogEntry, PatchBatch, Removal, Snapshot, Upsert } from './protocol.ts';
import { UsageLedger, WINDOW_1M, WINDOW_200K, contextWindowFor } from './usage.ts';
import { hashString } from './mascot.ts';
import { LIMITS, truncateText } from './truncate.ts';
import { AGENT_TOOLS } from './transcript.ts';
import { addRequest, emptyShares, type ChargedRequest } from './consumption.ts';
import { detectWorkflows, nativeWorkflowName, type NativeWorkflowCall, type SpawnRecord } from './workflow.ts';

const DIFF_RANK: Record<FileChange['diffSource'], number> = { none: 0, strings: 1, snapshot: 2, structuredPatch: 3 };
const IDLE_AFTER_MS = 10 * 60 * 1000;
/** A "busy" sub-agent (running tool, pending permission) silent for this long is considered finished. */
const STALE_BUSY_MS = 60 * 60 * 1000;
const PROMPT_DEDUP_MS = 60 * 1000;
const TIMELINE_MINUTES = 180;
const MINUTE = 60_000;
/** Messages kept per session (oldest dropped first). */
const MESSAGES_PER_SESSION = 400;
const MESSAGE_CHARS = 4000;
/** A queued message delivered this fast was never really waiting: it is a normal prompt. */
const QUEUE_INSTANT_MS = 1500;
const LIVE_TEXT_CHARS = 1200;
/** Simulated sessions (ids starting with "sim-") are forgotten after this idle time. */
const SIM_TTL_MS = 15 * 60 * 1000;
/** The same compaction / API error reported by hook and transcript within this window counts once. */
const DUP_WINDOW_MS = 60 * 1000;
/** Per-agent cap of the file summary sent with every agent patch (full history stays in `files`). */
const FILE_SUMMARY_CAP = 40;
const EVICTED_TOOLS_CAP = 20_000;

export interface StoreOptions {
  maxSessions?: number;
  now?: () => number;
}

function basename(p: string | null | undefined): string | null {
  if (!p) return null;
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** Short human preview of a tool input for the room label. */
export function toolInputPreview(name: string, input: Record<string, unknown>): string | null {
  const s = (k: string): string | null => (typeof input[k] === 'string' ? (input[k] as string) : null);
  const path = s('file_path') ?? s('notebook_path') ?? s('path');
  if (path) return basename(path);
  const cmd = s('command');
  if (cmd) return truncateText(cmd.split('\n')[0] ?? cmd, 60);
  const other = s('pattern') ?? s('query') ?? s('url') ?? s('description') ?? s('skill') ?? s('prompt');
  if (other) return truncateText(other, 60);
  return name === 'Workflow' ? nativeWorkflowName(input) : null;
}

function newAgent(p: Partial<Agent> & Pick<Agent, 'id' | 'sessionId' | 'kind'>, at: number): Agent {
  return {
    parentId: null,
    type: p.kind === 'main' ? 'main' : 'general-purpose',
    description: '',
    prompt: '',
    model: null,
    status: p.kind === 'main' ? 'idle' : 'starting',
    startedAt: at,
    endedAt: null,
    lastActivityAt: at,
    usage: { ...EMPTY_USAGE },
    currentTool: null,
    currentToolInputPreview: null,
    spawnToolUseId: null,
    parentMessageId: null,
    parentTurn: 0,
    background: false,
    workflowId: null,
    stepIndex: null,
    toolCount: 0,
    errorCount: 0,
    added: 0,
    removed: 0,
    files: {},
    lastMessage: null,
    turns: 0,
    contextTokens: 0,
    contextAt: 0,
    contextWindow: WINDOW_200K,
    compactions: 0,
    todos: [],
    liveText: null,
    liveTextAt: 0,
    liveTextFinal: true,
    waiting: null,
    ...p,
  };
}

/** Parse TodoWrite `todos` input defensively. */
export function parseTodos(v: unknown): TodoItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: TodoItem[] = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const content = typeof o['content'] === 'string' ? o['content'] : typeof o['subject'] === 'string' ? o['subject'] : null;
    if (!content) continue;
    const st = o['status'];
    out.push({
      content,
      status: st === 'completed' || st === 'in_progress' ? st : 'pending',
      activeForm: typeof o['activeForm'] === 'string' ? o['activeForm'] : null,
    });
  }
  return out;
}

function levelOf(ev: NormalizedEvent): LogEntry['level'] {
  switch (ev.kind) {
    case 'error':
      return 'error';
    case 'tool.end':
      return ev.ok ? 'info' : 'error';
    case 'agent.stop':
      return ev.status === 'error' ? 'error' : 'success';
    case 'attention':
      return 'warn';
    case 'agent.spawn':
    case 'compact':
      return 'success';
    default:
      return 'info';
  }
}

/**
 * In-memory state, reduced from normalized events. Idempotent: applying the
 * same fact twice (hook + transcript, or a replay) yields the same state.
 * Tracks changed entities so the server can broadcast coalesced patches.
 */
export class StateStore {
  readonly sessions = new Map<string, Session>();
  readonly agents = new Map<string, Agent>();
  readonly tools = new Map<string, ToolEvent>();
  readonly files = new Map<string, FileChange>();
  readonly workflows = new Map<string, Workflow>();

  private readonly ledgers = new Map<string, UsageLedger>();
  private readonly titlePriority = new Map<string, number>();
  /** Per session: prompt ids seen, and text keys (fallback when a prompt has no id). */
  private readonly promptIds = new Map<string, Set<string>>();
  private readonly promptTexts = new Map<string, Map<string, number>>();
  /** Agents set to done by tick() (no real stop event): revived by new activity. */
  private readonly staleDone = new Set<string>();
  private readonly lastCompactAt = new Map<string, number>();
  private readonly lastErrorAt = new Map<string, number>();
  private readonly loggedStarts = new Set<string>();
  /** Tools dropped by the per-agent cap: ignored if they show up again (replays). */
  private readonly evictedTools = new Map<string, true>();
  /** Per session, file change ids in arrival order (for the memory cap). */
  private readonly fileQueue = new Map<string, string[]>();
  /** toolUseId of an Agent call → id of the agent record holding it. */
  private readonly spawns = new Map<string, string>();
  private readonly runningTools = new Map<string, string[]>();
  private readonly agentTools = new Map<string, string[]>();
  private readonly natives = new Map<string, NativeWorkflowCall[]>();
  private readonly workflowDirty = new Set<string>();
  /** Message currently streamed per agent (MessageDisplay). */
  private readonly liveMessage = new Map<string, string>();
  readonly messages = new Map<string, Message>();
  /** Per session, message ids in arrival order (for the cap and lookups). */
  private readonly messageQueue = new Map<string, string[]>();
  /** Queued messages taken out of the queue (dequeue) whose prompt line may still follow: merged, not duplicated. */
  private readonly dequeued = new Set<string>();
  /** Context window set by an authoritative source (model identity, /context): wins over the model guess. */
  private readonly pinnedWindow = new Map<string, number>();
  /** Requests already counted in each session's usage shares, by message id (replays must not double them). */
  private readonly charged = new Map<string, Map<string, ChargedRequest>>();

  private readonly dirty = new Map<string, { kind: EntityKind; id: string }>();
  private readonly removals = new Map<string, Removal>();
  private pendingLogs: LogEntry[] = [];
  private readonly logRing: LogEntry[] = [];
  private logSeq = 0;
  private batchSeq = 0;
  private readonly maxSessions: number;
  private readonly now: () => number;
  readonly startedAt: number;

  constructor(opts: StoreOptions = {}) {
    this.maxSessions = opts.maxSessions ?? 40;
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
  }

  // ───────────────────────── change tracking ─────────────────────────

  private mark(kind: EntityKind, id: string): void {
    const key = `${kind}:${id}`;
    this.removals.delete(key);
    this.dirty.set(key, { kind, id });
  }

  private remove(kind: EntityKind, id: string): void {
    const key = `${kind}:${id}`;
    this.dirty.delete(key);
    this.removals.set(key, { op: 'remove', kind, id });
  }

  private entity<K extends EntityKind>(kind: K, id: string): EntityMap[K] | undefined {
    const m = { session: this.sessions, agent: this.agents, tool: this.tools, file: this.files, workflow: this.workflows, message: this.messages }[kind];
    return m.get(id) as EntityMap[K] | undefined;
  }

  get hasPending(): boolean {
    return this.dirty.size > 0 || this.removals.size > 0 || this.pendingLogs.length > 0 || this.workflowDirty.size > 0;
  }

  /** Collect coalesced changes since the last flush. Returns null if nothing changed. */
  flush(): PatchBatch | null {
    for (const sid of this.workflowDirty) this.recomputeWorkflows(sid);
    this.workflowDirty.clear();
    if (!this.dirty.size && !this.removals.size && !this.pendingLogs.length) return null;
    const changes: Array<Upsert | Removal> = [];
    for (const { kind, id } of this.dirty.values()) {
      const data = this.entity(kind, id);
      if (data) changes.push({ op: 'upsert', kind, data } as Upsert);
    }
    changes.push(...this.removals.values());
    this.dirty.clear();
    this.removals.clear();
    const logs = this.pendingLogs;
    this.pendingLogs = [];
    return { seq: ++this.batchSeq, changes, logs };
  }

  snapshot(): Snapshot {
    return {
      seq: this.batchSeq,
      serverStartedAt: this.startedAt,
      sessions: [...this.sessions.values()],
      agents: [...this.agents.values()],
      tools: [...this.tools.values()],
      files: [...this.files.values()],
      workflows: [...this.workflows.values()],
      messages: [...this.messages.values()],
      logs: [...this.logRing],
    };
  }

  get seq(): number {
    return this.batchSeq;
  }

  /** Log entries carry language-neutral content; the UI adds a localized label per `kind`. */
  private log(ev: NormalizedEvent, summary: string, agentId: string | null = null): void {
    const id = agentId ?? ('agentId' in ev && typeof ev.agentId === 'string' ? ev.agentId : null);
    const entry: LogEntry = { seq: ++this.logSeq, at: ev.at, source: ev.source, sessionId: ev.sessionId, agentId: id, kind: ev.kind, summary, level: levelOf(ev) };
    this.pendingLogs.push(entry);
    this.logRing.push(entry);
    if (this.logRing.length > LIMITS.logRing) this.logRing.shift();
  }

  // ───────────────────────── entity helpers ─────────────────────────

  private ensureSession(id: string, at: number, ev?: NormalizedEvent, meta = false): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        title: id.slice(0, 8),
        cwd: null,
        project: null,
        transcriptPath: null,
        model: null,
        // A session first seen through an undated metadata line gets its real start later.
        startedAt: at > 0 ? at : Date.now(),
        lastActivityAt: at > 0 ? at : 0,
        endedAt: null,
        status: 'active',
        sources: { hooks: false, transcript: false },
        lastPrompt: null,
        totalCostUSD: null,
        usageTimeline: { start: Math.floor(at / MINUTE) * MINUTE, buckets: [] },
        contextWindow: WINDOW_200K,
        tasks: [],
        usageShares: emptyShares(),
        contextUsage: null,
        narration: null,
      };
      this.sessions.set(id, s);
      this.agents.set(id, newAgent({ id, sessionId: id, kind: 'main', type: 'main', description: 'main' }, at > 0 ? at : Date.now()));
      this.mark('agent', id);
      this.pruneSessions(id);
    }
    if (ev) {
      if (ev.source === 'hook' && !s.sources.hooks) s.sources = { ...s.sources, hooks: true };
      if (ev.source === 'transcript' && !s.sources.transcript) s.sources = { ...s.sources, transcript: true };
    }
    if (meta) {
      this.mark('session', id);
      return s;
    }
    if (at > 0 && at < s.startedAt) s.startedAt = at;
    if (at > s.lastActivityAt) {
      s.lastActivityAt = at;
      if (s.status === 'idle' && at > this.now() - IDLE_AFTER_MS) s.status = 'active';
    }
    this.mark('session', id);
    return s;
  }

  private ensureAgent(sessionId: string, agentId: string, at: number): Agent {
    let a = this.agents.get(agentId);
    if (!a) {
      const start = at > 0 ? at : Date.now();
      a =
        agentId === sessionId
          ? newAgent({ id: agentId, sessionId, kind: 'main', type: 'main', description: 'main' }, start)
          : newAgent({ id: agentId, sessionId, kind: 'sub', parentId: sessionId, status: 'running' }, start);
      this.agents.set(agentId, a);
      this.workflowDirty.add(sessionId);
    }
    if (at > a.lastActivityAt) a.lastActivityAt = at;
    if (at > 0 && at < a.startedAt) a.startedAt = at;
    this.mark('agent', agentId);
    return a;
  }

  private ledger(agentId: string): UsageLedger {
    let l = this.ledgers.get(agentId);
    if (!l) this.ledgers.set(agentId, (l = new UsageLedger()));
    return l;
  }

  /** Move an agent record to a new id (pending `t:<toolUseId>` → real agent id). */
  private rekey(oldId: string, newId: string): Agent | undefined {
    const a = this.agents.get(oldId);
    if (!a || oldId === newId) return a;
    const existing = this.agents.get(newId);
    const merged: Agent = existing
      ? {
          ...existing,
          // Spawn-derived fields come from the pending record (it holds the Agent tool call).
          parentId: a.parentId ?? existing.parentId,
          type: a.type !== 'general-purpose' ? a.type : existing.type,
          description: a.description || existing.description,
          prompt: existing.prompt.length >= a.prompt.length ? existing.prompt : a.prompt,
          model: existing.model ?? a.model,
          spawnToolUseId: a.spawnToolUseId ?? existing.spawnToolUseId,
          parentMessageId: a.parentMessageId ?? existing.parentMessageId,
          parentTurn: a.parentTurn,
          background: a.background || existing.background,
          startedAt: Math.min(a.startedAt, existing.startedAt),
        }
      : { ...a, id: newId };
    this.agents.delete(oldId);
    this.agents.set(newId, merged);
    this.remove('agent', oldId);
    this.mark('agent', newId);
    if (merged.spawnToolUseId) this.spawns.set(merged.spawnToolUseId, newId);
    const oldLedger = this.ledgers.get(oldId);
    if (oldLedger && !this.ledgers.has(newId)) this.ledgers.set(newId, oldLedger);
    this.ledgers.delete(oldId);
    for (const t of this.tools.values()) if (t.agentId === oldId) { t.agentId = newId; this.mark('tool', t.id); }
    for (const f of this.files.values()) if (f.agentId === oldId) { f.agentId = newId; this.mark('file', f.id); }
    for (const c of this.agents.values()) if (c.parentId === oldId) { c.parentId = newId; this.mark('agent', c.id); }
    const tl = this.agentTools.get(oldId);
    if (tl) { this.agentTools.set(newId, [...(this.agentTools.get(newId) ?? []), ...tl]); this.agentTools.delete(oldId); }
    const rt = this.runningTools.get(oldId);
    if (rt) { this.runningTools.set(newId, [...(this.runningTools.get(newId) ?? []), ...rt]); this.runningTools.delete(oldId); }
    this.workflowDirty.add(merged.sessionId);
    return merged;
  }

  private refreshCurrentTool(a: Agent): void {
    const running = this.runningTools.get(a.id) ?? [];
    const lastId = running[running.length - 1];
    const t = lastId ? this.tools.get(lastId) : undefined;
    a.currentTool = t?.name ?? null;
    a.currentToolInputPreview = t ? toolInputPreview(t.name, t.input) : null;
  }

  /** Keep at most maxSessions; never evicts `keep` (the session being touched). */
  private pruneSessions(keep: string): void {
    if (this.sessions.size <= this.maxSessions) return;
    const sorted = [...this.sessions.values()].filter((x) => x.id !== keep).sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    let excess = this.sessions.size - this.maxSessions;
    for (const s of sorted) {
      if (excess-- <= 0) break;
      this.dropSession(s.id);
    }
  }

  /**
   * Agents can be resumed after they finished: SendMessage to a background agent, a coordinator
   * giving a new job after end_turn, a task notification followed by more work… Any activity
   * strictly newer than the end brings the agent back to "running".
   */
  /** Context window of an agent: authoritative value if known, else from its model; a context above it proves 1M. */
  private setWindow(s: Session, a: Agent): void {
    let w = this.pinnedWindow.get(a.id) ?? contextWindowFor(a.model);
    if (a.contextTokens > w) w = WINDOW_1M;
    a.contextWindow = w;
    if (a.kind === 'main' && s.contextWindow !== w) {
      s.contextWindow = w;
      this.mark('session', s.id);
    }
  }

  private addMessage(m: Message): void {
    if (this.messages.has(m.id)) return;
    this.messages.set(m.id, { ...m, text: truncateText(m.text, MESSAGE_CHARS) });
    this.mark('message', m.id);
    let q = this.messageQueue.get(m.sessionId);
    if (!q) this.messageQueue.set(m.sessionId, (q = []));
    q.push(m.id);
    while (q.length > MESSAGES_PER_SESSION) {
      const old = q.shift() as string;
      this.messages.delete(old);
      this.remove('message', old);
    }
  }

  /** A dequeued message waiting for its prompt line, with this text. */
  private findDequeued(sessionId: string, text: string): Message | undefined {
    const key = text.trim();
    for (const id of this.dequeued) {
      const m = this.messages.get(id);
      if (m && m.sessionId === sessionId && m.text.trim() === key) return m;
    }
    return undefined;
  }

  /** Latest user message of a session with this text, in one of these states. */
  private findMessage(sessionId: string, text: string, states: Message['state'][]): Message | undefined {
    const key = text.trim();
    const q = this.messageQueue.get(sessionId) ?? [];
    for (let i = q.length - 1; i >= 0 && i >= q.length - 80; i--) {
      const m = this.messages.get(q[i] as string);
      if (m && m.role === 'user' && states.includes(m.state) && m.text.trim() === key) return m;
    }
    return undefined;
  }

  private revive(a: Agent, at: number): void {
    if ((a.status === 'done' || a.status === 'error') && a.endedAt !== null && at > a.endedAt) {
      this.staleDone.delete(a.id);
      a.status = 'running';
      a.endedAt = null;
    }
  }

  dropSession(id: string): void {
    this.sessions.delete(id);
    this.remove('session', id);
    const agentIds = new Set<string>();
    for (const [k, v] of this.agents) {
      if (v.sessionId !== id) continue;
      agentIds.add(k);
      this.agents.delete(k);
      this.remove('agent', k);
    }
    for (const k of agentIds) {
      this.ledgers.delete(k);
      this.agentTools.delete(k);
      this.runningTools.delete(k);
      this.liveMessage.delete(k);
      this.staleDone.delete(k);
      this.lastCompactAt.delete(k);
      this.lastErrorAt.delete(k);
      this.pinnedWindow.delete(k);
    }
    for (const mid of this.messageQueue.get(id) ?? []) {
      this.messages.delete(mid);
      this.dequeued.delete(mid);
      this.remove('message', mid);
    }
    this.messageQueue.delete(id);
    this.charged.delete(id);
    for (const [tu, holder] of this.spawns) if (agentIds.has(holder)) this.spawns.delete(tu);
    for (const [k, v] of this.tools) if (v.sessionId === id) { this.tools.delete(k); this.remove('tool', k); }
    for (const [k, v] of this.files) if (v.sessionId === id) { this.files.delete(k); this.remove('file', k); }
    for (const [k, v] of this.workflows) if (v.sessionId === id) { this.workflows.delete(k); this.remove('workflow', k); }
    this.natives.delete(id);
    this.promptIds.delete(id);
    this.promptTexts.delete(id);
    this.titlePriority.delete(id);
    this.loggedStarts.delete(id);
    this.fileQueue.delete(id);
    this.workflowDirty.delete(id);
  }

  /** Periodic housekeeping: mark stale sessions/agents idle, forget old simulations. */
  tick(now: number = this.now()): void {
    for (const s of [...this.sessions.values()]) {
      if (s.id.startsWith('sim-') && now - s.lastActivityAt > SIM_TTL_MS) {
        this.dropSession(s.id);
        continue;
      }
      if (s.status === 'active' && now - s.lastActivityAt > IDLE_AFTER_MS) {
        s.status = 'idle';
        this.mark('session', s.id);
      }
    }
    for (const a of this.agents.values()) {
      if (a.status !== 'running' && a.status !== 'starting') continue;
      const session = this.sessions.get(a.sessionId);
      // Agents of an ended session cannot still be working (e.g. older transcript lines replayed after the end).
      const sessionOver = session?.status === 'ended' && session.endedAt !== null && a.lastActivityAt <= session.endedAt;
      if (sessionOver || now - a.lastActivityAt > IDLE_AFTER_MS) {
        // A long command or a pending permission is not the end of a sub-agent (but nothing lasts an hour unnoticed).
        const busy = a.waiting || (this.runningTools.get(a.id)?.length ?? 0) > 0;
        if (a.kind === 'sub' && busy && !sessionOver && now - a.lastActivityAt < STALE_BUSY_MS) continue;
        a.status = a.kind === 'main' ? (sessionOver ? 'done' : 'idle') : 'done';
        a.waiting = null;
        if (a.kind === 'sub') {
          this.staleDone.add(a.id);
          if (!a.endedAt) a.endedAt = a.lastActivityAt;
        }
        a.currentTool = null;
        a.currentToolInputPreview = null;
        this.runningTools.delete(a.id);
        this.mark('agent', a.id);
      }
    }
  }

  // ───────────────────────── reducer ─────────────────────────

  apply(ev: NormalizedEvent): void {
    // Titles, costs and narration are metadata: they must not make an old session look active.
    const meta = ev.kind === 'session.title' || ev.kind === 'session.cost' || ev.kind === 'narration';
    const s = this.ensureSession(ev.sessionId, ev.at, ev, meta);
    switch (ev.kind) {
      case 'session.start': {
        if (ev.cwd) { s.cwd = ev.cwd; s.project = basename(ev.cwd); }
        if (ev.transcriptPath) s.transcriptPath = ev.transcriptPath;
        if (ev.model) s.model = ev.model;
        if (!this.titlePriority.has(s.id) && s.project) s.title = s.project;
        if (ev.source === 'hook') { s.endedAt = null; s.status = 'active'; }
        if (!this.loggedStarts.has(s.id)) {
          this.loggedStarts.add(s.id);
          this.log(ev, s.project ?? s.id.slice(0, 8));
        }
        break;
      }
      case 'session.title': {
        if ((this.titlePriority.get(s.id) ?? 0) <= ev.priority) {
          this.titlePriority.set(s.id, ev.priority);
          s.title = ev.title;
        }
        break;
      }
      case 'session.end': {
        s.endedAt = ev.at;
        s.status = 'ended';
        // Claude Code is gone: nothing of this session is still running (sub-agents included).
        for (const a of this.agents.values()) {
          if (a.sessionId !== s.id) continue;
          if (a.kind === 'main' || a.status === 'running' || a.status === 'starting') {
            if (a.status !== 'error') a.status = 'done';
            if (a.kind === 'sub') a.endedAt = a.endedAt ?? ev.at;
            a.currentTool = null;
            a.currentToolInputPreview = null;
            a.waiting = null;
            this.runningTools.delete(a.id);
            this.mark('agent', a.id);
          }
        }
        this.log(ev, s.title);
        break;
      }
      case 'session.cost':
        s.totalCostUSD = ev.totalCostUSD;
        break;
      case 'prompt': {
        // Hooks and transcripts share the prompt id (verified): dedupe on it. The text window is only a
        // fallback for prompts without id, so a user repeating "continue" is still counted.
        let ids = this.promptIds.get(s.id);
        if (!ids) this.promptIds.set(s.id, (ids = new Set()));
        let texts = this.promptTexts.get(s.id);
        if (!texts) this.promptTexts.set(s.id, (texts = new Map()));
        const textKey = `${ev.agentId}|${ev.text.slice(0, 300)}`;
        if (ev.promptId) {
          if (ids.has(ev.promptId)) break;
          ids.add(ev.promptId);
        } else {
          const seen = texts.get(textKey);
          if (seen !== undefined && Math.abs(seen - ev.at) < PROMPT_DEDUP_MS) break;
        }
        texts.set(textKey, ev.at);
        if (texts.size > 500) texts.delete(texts.keys().next().value as string);
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        a.turns += 1;
        if (a.kind === 'main') s.lastPrompt = truncateText(ev.text, 300);
        // A prompt older than the session's end is history (replay order), not a resumed session.
        const stale = s.status === 'ended' && s.endedAt !== null && ev.at <= s.endedAt;
        if (!stale) {
          a.status = 'running';
          a.waiting = null;
          if (s.status === 'ended') { s.status = 'active'; s.endedAt = null; }
        }
        // A message typed while Claude was busy was shown as queued: it is now delivered.
        const queued = this.findMessage(s.id, ev.text, ['queued', 'removed']) ?? this.findDequeued(s.id, ev.text);
        if (queued) {
          if (queued.state === 'queued' || queued.state === 'removed') queued.state = ev.at - queued.at < QUEUE_INSTANT_MS ? 'sent' : 'delivered';
          this.dequeued.delete(queued.id);
          this.mark('message', queued.id);
        } else this.addMessage({ id: `u:${s.id}:${ev.promptId ?? `${ev.at}:${hashString(ev.text.slice(0, 300))}`}`, sessionId: s.id, agentId: a.id, at: ev.at, role: 'user', text: ev.text, state: 'sent', midTurn: false });
        this.log(ev, truncateText(ev.text.replace(/\s+/g, ' '), 80), a.id);
        break;
      }
      case 'message.queue': {
        if (ev.op === 'dequeue') {
          // Claude Code takes the oldest message out of the queue: it is handed over (a slash
          // command never comes back as a prompt line, so this is the only sign it was used).
          const q = this.messageQueue.get(s.id) ?? [];
          for (const id of q) {
            const m = this.messages.get(id);
            if (m?.role !== 'user' || m.state !== 'queued') continue;
            m.state = ev.at - m.at < QUEUE_INSTANT_MS ? 'sent' : 'delivered';
            this.dequeued.add(m.id);
            if (this.dequeued.size > 200) this.dequeued.delete(this.dequeued.values().next().value as string);
            this.mark('message', m.id);
            break;
          }
          break;
        }
        if (!ev.text) break;
        const text = ev.text.trim();
        // Background agents' notifications travel through the same queue: not user messages.
        if (!text || text.startsWith('<')) break;
        if (ev.op === 'enqueue') {
          if (this.findMessage(s.id, text, ['queued'])) break;
          this.addMessage({ id: `q:${s.id}:${ev.at}:${hashString(text.slice(0, 300))}`, sessionId: s.id, agentId: ev.agentId, at: ev.at, role: 'user', text, state: 'queued', midTurn: false });
          this.log(ev, truncateText(text.replace(/\s+/g, ' '), 80), ev.agentId);
        } else {
          const m = this.findMessage(s.id, text, ['queued']);
          if (m) {
            m.state = 'removed';
            this.mark('message', m.id);
          }
        }
        break;
      }
      case 'message.inject': {
        // Claude received a queued message inside its running turn (no new prompt, no new turn).
        const text = ev.text.trim();
        if (!text) break;
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        const m = this.findMessage(s.id, text, ['queued', 'removed']);
        if (m) {
          m.state = 'delivered';
          m.midTurn = true;
          this.mark('message', m.id);
        } else if (!this.findMessage(s.id, text, ['delivered'])) {
          this.addMessage({ id: `i:${s.id}:${ev.at}:${hashString(text.slice(0, 300))}`, sessionId: s.id, agentId: a.id, at: ev.at, role: 'user', text, state: 'delivered', midTurn: true });
        }
        if (a.kind === 'main') s.lastPrompt = truncateText(text, 300);
        a.waiting = null;
        this.mark('agent', a.id);
        this.log(ev, truncateText(text.replace(/\s+/g, ' '), 80), a.id);
        break;
      }
      case 'context.window': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.pinnedWindow.set(a.id, ev.window);
        this.setWindow(s, a);
        this.mark('agent', a.id);
        break;
      }
      case 'agent.spawn': {
        const parent = this.ensureAgent(s.id, ev.parentAgentId, ev.at);
        const holder = this.spawns.get(ev.toolUseId);
        const id = holder ?? `t:${ev.toolUseId}`;
        let a = this.agents.get(id);
        if (!a) {
          a = newAgent({ id, sessionId: s.id, kind: 'sub', parentId: parent.id, spawnToolUseId: ev.toolUseId, parentTurn: parent.turns }, ev.at);
          this.agents.set(id, a);
          this.spawns.set(ev.toolUseId, id);
          this.log(ev, `${ev.agentType} — ${ev.description}`, id);
        }
        a.parentId = parent.id;
        a.spawnToolUseId = ev.toolUseId;
        // Created earlier from its meta.json (read before the parent transcript): learn its turn now,
        // or the heuristic would group agents of different turns into one workflow.
        if (holder && !a.parentTurn) a.parentTurn = parent.turns;
        if (ev.parentMessageId) a.parentMessageId = ev.parentMessageId;
        if (a.type === 'general-purpose' || !a.type) a.type = ev.agentType;
        if (!a.description) a.description = ev.description;
        if (ev.prompt.length > a.prompt.length) a.prompt = ev.prompt;
        if (ev.model && !a.model) a.model = ev.model;
        a.background = a.background || ev.background;
        if (ev.at < a.startedAt) a.startedAt = ev.at;
        this.mark('agent', a.id);
        this.workflowDirty.add(s.id);
        break;
      }
      case 'agent.start': {
        let a = this.agents.get(ev.agentId);
        if (ev.toolUseId) {
          this.link(s.id, ev.agentId, ev.toolUseId, null, ev.at);
          a = this.agents.get(ev.agentId);
        } else if (!a) {
          // Hook SubagentStart has no tool_use_id: match the oldest pending spawn (same type preferred).
          const pending = [...this.agents.values()]
            .filter((x) => x.sessionId === s.id && x.id.startsWith('t:'))
            .sort((x, y) => x.startedAt - y.startedAt);
          // Without a type (first line of a sub-agent transcript), guessing among several spawns is a
          // coin toss: wait for the meta.json link instead.
          const match = ev.agentType ? (pending.find((x) => x.type === ev.agentType) ?? pending[0]) : pending.length === 1 ? pending[0] : undefined;
          if (match) a = this.rekey(match.id, ev.agentId);
        }
        const known = !!a;
        a = a ?? this.ensureAgent(s.id, ev.agentId, ev.at);
        if (ev.agentType && (a.type === 'general-purpose' || !a.type)) a.type = ev.agentType;
        if (ev.description && !a.description) a.description = ev.description;
        if (ev.prompt && ev.prompt.length > a.prompt.length) a.prompt = ev.prompt;
        const wasStarting = a.status === 'starting';
        if (wasStarting) a.status = 'running';
        if (a.lastActivityAt < ev.at) a.lastActivityAt = ev.at;
        this.mark('agent', a.id);
        this.workflowDirty.add(s.id);
        if (!known || wasStarting) this.log(ev, `${a.type} ${ev.agentId}`);
        break;
      }
      case 'agent.link':
        this.link(s.id, ev.agentId, ev.toolUseId, ev.model ?? null, ev.at);
        break;
      case 'agent.stop': {
        // Task notifications also exist for non-agent background tasks: never invent an agent
        // for an unknown id, unless the stop comes from SubagentStop (which names the agent type).
        let a = this.agents.get(ev.agentId);
        if (!a && !ev.agentType) break;
        a = a ?? this.ensureAgent(s.id, ev.agentId, ev.at);
        if (ev.agentType && (a.type === 'general-purpose' || !a.type)) a.type = ev.agentType;
        this.staleDone.delete(a.id);
        const changed = a.status !== ev.status && a.status !== 'error';
        if (a.status !== 'error' || ev.status === 'error') a.status = ev.status;
        a.endedAt = Math.max(a.endedAt ?? 0, ev.at);
        a.currentTool = null;
        a.currentToolInputPreview = null;
        this.runningTools.delete(a.id);
        if (ev.lastMessage) a.lastMessage = ev.lastMessage;
        this.mark('agent', a.id);
        if (changed) this.log(ev, `${a.type} — ${a.description || a.id}`);
        break;
      }
      case 'tool.start': {
        if (this.evictedTools.has(ev.toolUseId)) break;
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.revive(a, ev.at);
        let t = this.tools.get(ev.toolUseId);
        if (!t) {
          t = {
            id: ev.toolUseId,
            sessionId: s.id,
            agentId: a.id,
            name: ev.name,
            input: ev.input,
            status: 'running',
            startedAt: ev.at,
            endedAt: null,
            output: null,
            error: null,
            filePath: toolFilePath(ev.input),
            parentMessageId: ev.parentMessageId,
            durationMs: null,
            interrupted: false,
          };
          this.tools.set(t.id, t);
          a.toolCount += 1;
          this.registerTool(a.id, t.id);
          const running = this.runningTools.get(a.id) ?? [];
          running.push(t.id);
          this.runningTools.set(a.id, running);
          this.log(ev, `${a.kind === 'main' ? 'main' : a.type}: ${ev.name} ${toolInputPreview(ev.name, ev.input) ?? ''}`);
        } else {
          if (ev.parentMessageId) t.parentMessageId = ev.parentMessageId;
          if (ev.at < t.startedAt) t.startedAt = ev.at;
          if (Object.keys(t.input).length === 0) t.input = ev.input;
        }
        if (ev.name === 'TodoWrite') {
          const todos = parseTodos(ev.input['todos']);
          if (todos) a.todos = todos;
        }
        a.waiting = null;
        if (ev.name === 'Workflow') {
          const list = this.natives.get(s.id) ?? [];
          if (!list.some((n) => n.toolUseId === ev.toolUseId)) {
            list.push({ toolUseId: ev.toolUseId, ownerAgentId: a.id, name: nativeWorkflowName(ev.input) ?? 'workflow', startedAt: ev.at });
            this.natives.set(s.id, list);
            this.workflowDirty.add(s.id);
          }
        }
        if (t.status === 'running') {
          if (a.status !== 'error' && a.status !== 'done') a.status = 'running';
          this.refreshCurrentTool(a);
        }
        this.mark('tool', t.id);
        this.mark('agent', a.id);
        break;
      }
      case 'tool.end': {
        if (this.evictedTools.has(ev.toolUseId)) break;
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        let t = this.tools.get(ev.toolUseId);
        if (!t) {
          t = {
            id: ev.toolUseId,
            sessionId: s.id,
            agentId: a.id,
            name: ev.name ?? 'outil',
            input: {},
            status: 'running',
            startedAt: ev.at,
            endedAt: null,
            output: null,
            error: null,
            filePath: null,
            parentMessageId: null,
            durationMs: null,
            interrupted: false,
          };
          this.tools.set(t.id, t);
          a.toolCount += 1;
          this.registerTool(a.id, t.id);
        }
        if (typeof ev.durationMs === 'number') t.durationMs = ev.durationMs;
        else if (t.durationMs === null) t.durationMs = Math.max(0, ev.at - t.startedAt);
        if (ev.interrupted) t.interrupted = true;
        a.waiting = null;
        const wasError = t.status === 'error';
        const wasDone = t.status !== 'running';
        t.status = ev.ok ? (wasError ? 'error' : 'ok') : 'error';
        t.endedAt = t.endedAt ?? ev.at;
        if (ev.output && (!t.output || ev.output.length > t.output.length)) t.output = ev.output;
        if (ev.error) t.error = ev.error;
        if (ev.name && t.name === 'outil') t.name = ev.name;
        if (!ev.ok && !wasError) {
          a.errorCount += 1;
          this.log(ev, `${t.name}: ${truncateText(ev.error ?? '', 80)}`);
        }
        const running = this.runningTools.get(a.id);
        if (running) {
          const i = running.indexOf(t.id);
          if (i >= 0) running.splice(i, 1);
        }
        if (!wasDone || running) this.refreshCurrentTool(a);
        // Agent tool calls finishing synchronously stop the child; async launches don't.
        if (AGENT_TOOLS.has(t.name) && !ev.ok) {
          const childId = this.spawns.get(t.id);
          const child = childId ? this.agents.get(childId) : undefined;
          if (child && child.status !== 'done') { child.status = 'error'; child.endedAt = ev.at; this.mark('agent', child.id); }
        }
        this.mark('tool', t.id);
        this.mark('agent', a.id);
        break;
      }
      case 'context.usage':
        if (!s.contextUsage || ev.usage.at >= s.contextUsage.at) s.contextUsage = ev.usage;
        break;
      case 'usage': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.revive(a, ev.at);
        const delta = this.ledger(a.id).record(ev.messageId, ev.usage);
        if (delta) {
          a.usage = this.ledger(a.id).total;
          this.addToTimeline(s, ev.at, delta.total);
          // Latest usage of this request replaces the one counted before.
          let reqs = this.charged.get(s.id);
          if (!reqs) this.charged.set(s.id, (reqs = new Map()));
          const prev = reqs.get(ev.messageId);
          const req: ChargedRequest = { usage: ev.usage, model: ev.model ?? prev?.model ?? null, sub: a.kind === 'sub', attribution: ev.attribution ?? prev?.attribution ?? null };
          if (prev) addRequest(s.usageShares, prev, -1);
          addRequest(s.usageShares, req, 1);
          reqs.set(ev.messageId, req);
        }
        // Context = size of the latest request (same formula as Claude Code's indicator).
        if (ev.at >= a.contextAt) {
          a.contextAt = ev.at;
          a.contextTokens = ev.usage.input + ev.usage.cacheCreate + ev.usage.cacheRead;
        }
        if (ev.model && ev.model !== '<synthetic>') {
          a.model = ev.model;
          if (a.kind === 'main') s.model = ev.model;
        }
        this.setWindow(s, a);
        this.mark('agent', a.id);
        break;
      }
      case 'assistant.text': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.revive(a, ev.at);
        a.lastMessage = ev.text;
        this.addMessage({ id: `a:${a.id}:${ev.at}:${hashString(ev.text.slice(0, 300))}`, sessionId: s.id, agentId: a.id, at: ev.at, role: 'assistant', text: ev.text, state: 'sent', midTurn: false });
        this.mark('agent', a.id);
        break;
      }
      case 'turn.end': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.staleDone.delete(a.id);
        if (ev.lastMessage) a.lastMessage = ev.lastMessage;
        if (a.kind === 'main') {
          // 'done' = the session ended: an older turn end must not bring it back to idle.
          if (a.status !== 'error' && a.status !== 'done') a.status = 'idle';
        } else if (a.status !== 'error') {
          a.status = 'done';
          a.endedAt = a.endedAt ?? ev.at;
        }
        a.waiting = null;
        // Background tools may still be running; keep them but clear the label.
        a.currentTool = null;
        a.currentToolInputPreview = null;
        this.runningTools.delete(a.id);
        this.mark('agent', a.id);
        break;
      }
      case 'file.change': {
        const c = ev.change;
        const prev = this.files.get(c.id);
        if (prev) {
          if (prev.operation !== 'read' && c.operation === 'read') break;
          if (prev.operation !== 'read' && DIFF_RANK[prev.diffSource] > DIFF_RANK[c.diffSource]) break;
          // Keep line numbers if the new diff lacks them.
          if (prev.operation !== 'read' && DIFF_RANK[prev.diffSource] === DIFF_RANK[c.diffSource] && prev.hunks.length && !c.hunks.length) break;
        }
        const a = this.ensureAgent(s.id, c.agentId, c.at);
        const change: FileChange = { ...c, agentId: a.id };
        this.files.set(c.id, change);
        this.applyFileSummary(a, prev, change);
        this.capFiles(s.id, prev ? null : c.id);
        this.mark('file', c.id);
        this.mark('agent', a.id);
        if (change.operation !== 'read') this.log(ev, `${change.operation} ${basename(change.path)} +${change.added}/-${change.removed}`);
        break;
      }
      case 'notification':
        this.log(ev, ev.message);
        break;
      case 'error': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        // StopFailure hook and the transcript's API-error line describe the same failure.
        const lastErr = this.lastErrorAt.get(a.id);
        if (lastErr !== undefined && Math.abs(lastErr - ev.at) < DUP_WINDOW_MS) break;
        this.lastErrorAt.set(a.id, ev.at);
        a.errorCount += 1;
        a.status = 'error';
        this.mark('agent', a.id);
        this.log(ev, ev.message);
        break;
      }
      case 'todos': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        const before = new Map(a.todos.map((t) => [t.content, t.status]));
        for (const t of ev.todos) {
          if (t.status === 'completed' && before.has(t.content) && before.get(t.content) !== 'completed') {
            this.addMessage({ id: `t:${a.id}:${hashString(t.content)}`, sessionId: s.id, agentId: a.id, at: ev.at, role: 'task', text: t.content, state: 'sent', midTurn: false });
          }
        }
        a.todos = ev.todos;
        this.mark('agent', a.id);
        break;
      }
      case 'live.text': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        this.revive(a, ev.at);
        const fresh = this.liveMessage.get(a.id) !== ev.messageId;
        this.liveMessage.set(a.id, ev.messageId);
        const text = (fresh ? '' : (a.liveText ?? '')) + ev.delta;
        a.liveText = text.length > LIVE_TEXT_CHARS ? `…${text.slice(-LIVE_TEXT_CHARS)}` : text;
        a.liveTextAt = ev.at;
        a.liveTextFinal = ev.final;
        if (a.kind === 'sub' || a.status === 'idle') a.status = a.status === 'idle' ? 'running' : a.status;
        this.mark('agent', a.id);
        break;
      }
      case 'compact': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        // PostCompact hook and the transcript compact_boundary line describe the same compaction.
        const lastC = this.lastCompactAt.get(a.id);
        if (lastC !== undefined && Math.abs(lastC - ev.at) < DUP_WINDOW_MS) break;
        this.lastCompactAt.set(a.id, ev.at);
        a.compactions += 1;
        a.contextTokens = 0;
        a.contextAt = ev.at;
        this.mark('agent', a.id);
        this.log(ev, `${ev.trigger ?? ''}${ev.preTokens ? ` · ${Math.round(ev.preTokens / 1000)}k` : ''}`.trim());
        break;
      }
      case 'task': {
        const existing = s.tasks.find((x) => x.id === ev.taskId);
        if (existing) {
          if (ev.status === 'completed') existing.status = 'completed';
          if (ev.subject) existing.subject = ev.subject;
        } else {
          s.tasks = [...s.tasks, { id: ev.taskId, subject: ev.subject, description: ev.description, status: ev.status, agentId: ev.agentId, at: ev.at }].slice(-200);
          this.log(ev, ev.subject);
        }
        if (ev.status === 'completed' && existing) {
          this.log(ev, `✓ ${ev.subject}`);
          this.addMessage({ id: `k:${s.id}:${ev.taskId}`, sessionId: s.id, agentId: ev.agentId ?? s.id, at: ev.at, role: 'task', text: existing.subject, state: 'sent', midTurn: false });
        }
        break;
      }
      case 'narration':
        s.narration = ev.narration;
        break;
      case 'attention': {
        const a = this.ensureAgent(s.id, ev.agentId, ev.at);
        a.waiting = ev.message;
        this.mark('agent', a.id);
        this.log(ev, ev.message);
        break;
      }
    }
  }

  private addToTimeline(s: Session, at: number, tokens: number): void {
    if (tokens === 0) return;
    const tl = s.usageTimeline;
    const minute = Math.floor(at / MINUTE) * MINUTE;
    if (tl.buckets.length === 0) tl.start = minute;
    if (minute < tl.start) {
      // Older data (e.g. transcript replay after hooks): extend to the left if within the window.
      const shift = Math.round((tl.start - minute) / MINUTE);
      if (shift + tl.buckets.length > TIMELINE_MINUTES) return;
      tl.buckets = [...new Array<number>(shift).fill(0), ...tl.buckets];
      tl.start = minute;
    }
    const i = Math.round((minute - tl.start) / MINUTE);
    while (tl.buckets.length <= i) tl.buckets.push(0);
    tl.buckets[i] = (tl.buckets[i] ?? 0) + tokens;
    if (tl.buckets.length > TIMELINE_MINUTES) {
      const drop = tl.buckets.length - TIMELINE_MINUTES;
      tl.buckets = tl.buckets.slice(drop);
      tl.start += drop * MINUTE;
    }
    s.usageTimeline = { start: tl.start, buckets: tl.buckets };
  }

  applyAll(events: Iterable<NormalizedEvent>): void {
    for (const e of events) this.apply(e);
  }

  private link(sessionId: string, agentId: string, toolUseId: string, model: string | null, at: number): void {
    const holder = this.spawns.get(toolUseId);
    if (holder && holder !== agentId) {
      // If the agent was wrongly matched to another spawn, give that spawn back to a pending record.
      const current = this.agents.get(agentId);
      if (current?.spawnToolUseId && current.spawnToolUseId !== toolUseId) this.releaseSpawn(current);
      if (holder.startsWith('t:')) {
        this.rekey(holder, agentId);
      } else {
        // A previous FIFO guess was wrong: move the spawn info to the right agent.
        const wrong = this.agents.get(holder);
        const right = this.ensureAgent(sessionId, agentId, at);
        if (wrong) {
          right.parentId = wrong.parentId;
          right.parentMessageId = wrong.parentMessageId;
          right.parentTurn = wrong.parentTurn;
          // What came from this spawn belongs to the right agent, not to the earlier wrong guess.
          if (wrong.description) right.description = wrong.description;
          if (wrong.prompt) right.prompt = wrong.prompt;
          right.background = wrong.background;
          wrong.spawnToolUseId = null;
          wrong.parentMessageId = null;
          wrong.description = '';
          wrong.prompt = '';
          this.mark('agent', wrong.id);
        }
        right.spawnToolUseId = toolUseId;
        this.spawns.set(toolUseId, agentId);
      }
    } else if (!holder) {
      const a = this.ensureAgent(sessionId, agentId, at);
      a.spawnToolUseId = toolUseId;
      this.spawns.set(toolUseId, agentId);
      // If the spawning tool call is known, recover its parent.
      const t = this.tools.get(toolUseId);
      if (t) {
        a.parentId = t.agentId;
        if (t.parentMessageId) a.parentMessageId = t.parentMessageId;
      }
    }
    const a = this.agents.get(agentId);
    if (a) {
      if (model && !a.model) a.model = model;
      if (a.status === 'starting') a.status = 'running';
      this.mark('agent', a.id);
    }
    this.workflowDirty.add(sessionId);
  }

  /** Detach the spawn info of a wrongly matched agent into a pending `t:<toolUseId>` record. */
  private releaseSpawn(a: Agent): void {
    const tu = a.spawnToolUseId;
    if (!tu) return;
    const pendingId = `t:${tu}`;
    this.agents.set(
      pendingId,
      newAgent(
        {
          id: pendingId,
          sessionId: a.sessionId,
          kind: 'sub',
          parentId: a.parentId,
          type: a.type,
          description: a.description,
          prompt: a.prompt,
          spawnToolUseId: tu,
          parentMessageId: a.parentMessageId,
          parentTurn: a.parentTurn,
          background: a.background,
        },
        a.startedAt,
      ),
    );
    this.spawns.set(tu, pendingId);
    this.mark('agent', pendingId);
    a.spawnToolUseId = null;
    a.parentMessageId = null;
    a.description = '';
    a.prompt = '';
    a.type = 'general-purpose';
  }

  private applyFileSummary(a: Agent, prev: FileChange | undefined, c: FileChange): void {
    if (prev && prev.agentId === a.id) {
      const ps = a.files[prev.path];
      if (ps) {
        if (prev.operation === 'read') ps.reads -= 1;
        else ps.edits -= 1;
        ps.added -= prev.added;
        ps.removed -= prev.removed;
      }
      a.added -= prev.added;
      a.removed -= prev.removed;
    }
    const fs = a.files[c.path] ?? { path: c.path, reads: 0, edits: 0, added: 0, removed: 0, lastOp: c.operation, lastAt: c.at };
    if (c.operation === 'read') fs.reads += 1;
    else fs.edits += 1;
    fs.added += c.added;
    fs.removed += c.removed;
    if (c.at >= fs.lastAt) { fs.lastAt = c.at; fs.lastOp = c.operation; }
    const files = { ...a.files, [c.path]: fs };
    // Agent patches carry this map: keep only the most recent files (totals stay exact).
    const paths = Object.keys(files);
    if (paths.length > FILE_SUMMARY_CAP) {
      paths.sort((x, y) => (files[x]?.lastAt ?? 0) - (files[y]?.lastAt ?? 0));
      for (const pth of paths.slice(0, paths.length - FILE_SUMMARY_CAP)) delete files[pth];
    }
    a.files = files;
    a.added += c.added;
    a.removed += c.removed;
  }

  /** Track a tool in its agent's list; drop the oldest beyond the per-agent cap. */
  private registerTool(agentId: string, toolId: string): void {
    const list = this.agentTools.get(agentId) ?? [];
    list.push(toolId);
    while (list.length > LIMITS.toolsPerAgent) {
      const old = list.shift();
      if (!old) break;
      this.tools.delete(old);
      this.remove('tool', old);
      this.evictedTools.set(old, true);
      if (this.evictedTools.size > EVICTED_TOOLS_CAP) this.evictedTools.delete(this.evictedTools.keys().next().value as string);
    }
    this.agentTools.set(agentId, list);
  }

  /**
   * Memory cap per session, O(1) amortised: drop the oldest read records first, then strip
   * hunks of the oldest edits (their +/- counters stay in the summaries).
   */
  private capFiles(sessionId: string, newId: string | null): void {
    let q = this.fileQueue.get(sessionId);
    if (!q) this.fileQueue.set(sessionId, (q = []));
    if (newId) q.push(newId);
    if (q.length <= LIMITS.fileChangesPerSession) return;
    let excess = q.length - LIMITS.fileChangesPerSession;
    const keep: string[] = [];
    for (const id of q) {
      const f = this.files.get(id);
      if (!f) continue;
      if (excess > 0 && f.operation === 'read') {
        this.files.delete(id);
        this.remove('file', id);
        excess--;
        continue;
      }
      if (excess > 0 && f.hunks.length) {
        f.hunks = [];
        f.truncated = true;
        this.mark('file', id);
        excess--;
      }
      keep.push(id);
    }
    this.fileQueue.set(sessionId, keep);
  }

  private recomputeWorkflows(sessionId: string): void {
    const spawns: SpawnRecord[] = [];
    for (const a of this.agents.values()) {
      if (a.sessionId !== sessionId || a.kind !== 'sub' || !a.parentId) continue;
      spawns.push({
        agentId: a.id,
        parentId: a.parentId,
        spawnToolUseId: a.spawnToolUseId,
        parentMessageId: a.parentMessageId,
        parentTurn: a.parentTurn,
        startedAt: a.startedAt,
        description: a.description,
        prompt: a.prompt,
      });
    }
    const { workflows, assignment } = detectWorkflows(sessionId, spawns, this.natives.get(sessionId) ?? []);
    const seen = new Set<string>();
    for (const wf of workflows) {
      seen.add(wf.id);
      const prev = this.workflows.get(wf.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(wf)) {
        this.workflows.set(wf.id, wf);
        this.mark('workflow', wf.id);
      }
    }
    for (const [id, wf] of this.workflows) {
      if (wf.sessionId === sessionId && !seen.has(id)) {
        this.workflows.delete(id);
        this.remove('workflow', id);
      }
    }
    for (const a of this.agents.values()) {
      if (a.sessionId !== sessionId) continue;
      const asg = assignment.get(a.id);
      const wfId = asg?.workflowId ?? null;
      const step = asg?.stepIndex ?? null;
      if (a.workflowId !== wfId || a.stepIndex !== step) {
        a.workflowId = wfId;
        a.stepIndex = step;
        this.mark('agent', a.id);
      }
    }
  }
}

function toolFilePath(input: Record<string, unknown>): string | null {
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = input[k];
    if (typeof v === 'string') return v;
  }
  return null;
}
