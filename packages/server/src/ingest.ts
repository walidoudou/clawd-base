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

/** Merges hook and transcript sources into the state store. */
export class Ingest {
  readonly snapshots = new SnapshotStore();
  hookCount = 0;
  transcriptEventCount = 0;

  /** If set (env CLAWD_BASE_CAPTURE), raw hook payloads are appended to this JSONL file for debugging. */
  private readonly capturePath = env('CAPTURE') ?? null;

  constructor(private readonly store: StateStore, private readonly log: EventLog | null) {}

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
    this.log?.append(events);
  }

  /** Handle one raw hook payload. Resolves once file snapshots are captured. */
  async handleHook(payload: unknown): Promise<void> {
    this.hookCount++;
    if (this.capturePath) void appendFile(this.capturePath, `${JSON.stringify(payload)}\n`).catch(() => {});
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
        const content = await readCapped(path);
        if (content !== undefined) this.snapshots.set(toolUseId, content);
      } else if (event === 'PostToolUse' && path) {
        const before = this.snapshots.take(toolUseId);
        const after = await readCapped(path);
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
      } else if (event === 'PostToolUseFailure') {
        this.snapshots.delete(toolUseId);
      }
    }
    // Simulated sessions (ids starting with "sim-") are never persisted.
    const sid = typeof p['session_id'] === 'string' ? p['session_id'] : '';
    if (sid.startsWith('sim-')) this.applyEphemeral(events);
    else this.applyPersistent(events);
  }
}
