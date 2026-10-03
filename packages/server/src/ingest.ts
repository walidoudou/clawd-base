import {
  SNAPSHOT_TOOLS,
  StateStore,
  filePathOf,
  hookToEvents,
  hookToolOutput,
  makeFileChange,
  resolveFileDiff,
  type NormalizedEvent,
} from '@dash/shared';
import { appendFile } from 'node:fs/promises';
import { readCapped, SnapshotStore } from './snapshots.ts';
import { env } from './config.ts';
import type { EventLog } from './persist.ts';

type Obj = Record<string, unknown>;

const BACKLOG_MAX = 10_000;

/** Merges hook and transcript sources into the state store. */
export class Ingest {
  readonly snapshots = new SnapshotStore();
  hookCount = 0;
  transcriptEventCount = 0;

  /** If set (env CLAWD_BASE_CAPTURE), raw hook payloads are appended to this JSONL file for debugging. */
  private readonly capturePath = env('CAPTURE') ?? null;

  /** Persistent events received before the log is attached (it opens after listen), or null. */
  private backlog: NormalizedEvent[] | null = null;

  constructor(private readonly store: StateStore, private log: EventLog | null) {}

  /** The event log opens after listen: queue persistent events until attachLog() instead of losing them. */
  deferLog(): void {
    this.backlog ??= [];
  }

  attachLog(log: EventLog | null): void {
    this.log = log;
    const queued = this.backlog;
    this.backlog = null;
    if (queued?.length) log?.append(queued);
  }

  applyTranscript(events: NormalizedEvent[]): void {
    this.transcriptEventCount += events.length;
    this.store.applyAll(events);
  }

  /** Apply events without persisting them (simulator, replays). */
  applyEphemeral(events: NormalizedEvent[]): void {
    this.store.applyAll(events);
  }

  /** Apply events that must be persisted (hooks). */
  applyPersistent(events: NormalizedEvent[]): void {
    this.store.applyAll(events);
    if (this.backlog) {
      if (this.backlog.length < BACKLOG_MAX) this.backlog.push(...events);
    } else this.log?.append(events);
  }

  /**
   * Handle one raw hook payload. Resolves once file snapshots are captured.
   * `trusted`: the request carried this run's token (our own hook script). Any local account can reach
   * the endpoint, so an untrusted payload is still shown but never makes the server read a file (its
   * tool_input.file_path could point at something only we can read): no PreToolUse snapshot, no
   * after-read, and no access to snapshots taken for trusted calls. Its diff then comes only from what
   * the payload itself carries (structuredPatch, originalFile, old/new strings, Write content).
   */
  async handleHook(payload: unknown, trusted = false): Promise<void> {
    this.hookCount++;
    if (this.capturePath) void appendFile(this.capturePath, `${JSON.stringify(payload)}\n`, { mode: 0o600 }).catch(() => {});
    const now = Date.now();
    const events = hookToEvents(payload, now);
    const p = (payload && typeof payload === 'object' ? payload : {}) as Obj;
    const event = p['hook_event_name'];
    const toolName = typeof p['tool_name'] === 'string' ? p['tool_name'] : null;
    const toolUseId = typeof p['tool_use_id'] === 'string' ? p['tool_use_id'] : null;
    const input = (p['tool_input'] && typeof p['tool_input'] === 'object' ? p['tool_input'] : {}) as Obj;

    if (toolName && toolUseId && SNAPSHOT_TOOLS.has(toolName)) {
      const path = filePathOf(input);
      if (event === 'PreToolUse' && path) {
        if (trusted) {
          const content = await readCapped(path);
          if (content !== undefined) this.snapshots.set(toolUseId, content);
        }
      } else if (event === 'PostToolUse' && path) {
        const before = trusted ? this.snapshots.take(toolUseId) : undefined;
        const after = trusted ? await readCapped(path) : undefined;
        const diff = resolveFileDiff({
          toolName,
          input,
          result: hookToolOutput(p),
          before,
          after: after === undefined ? undefined : after,
        });
        const sessionId = String(p['session_id'] ?? '');
        const agentId = typeof p['agent_id'] === 'string' ? p['agent_id'] : sessionId;
        if (diff && sessionId) {
          events.push({ sessionId, at: now, source: 'hook', kind: 'file.change', change: makeFileChange({ id: toolUseId, sessionId, agentId, at: now }, diff) });
        }
      } else if (event === 'PostToolUseFailure' && trusted) {
        this.snapshots.delete(toolUseId);
      }
    }
    // Simulated sessions (ids starting with "sim-") are never persisted.
    const sid = typeof p['session_id'] === 'string' ? p['session_id'] : '';
    if (sid.startsWith('sim-')) this.applyEphemeral(events);
    else this.applyPersistent(events);
  }
}
