import type { NormalizedEvent } from './events.ts';
import { usageFromApi } from './usage.ts';
import { LIMITS, stringifyOutput, truncateRecord, truncateText } from './truncate.ts';
import { EDIT_TOOLS, READ_TOOLS, filePathOf, makeFileChange, makeReadChange, resolveFileDiff } from './diff.ts';

export const AGENT_TOOLS = new Set(['Agent', 'Task']);

export interface TranscriptContext {
  sessionId: string;
  /** Set when parsing `subagents/agent-<id>.jsonl`. */
  agentId: string | null;
  /** Absolute path of the file (for session.start). */
  path?: string | null;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

const NON_PROMPT_PREFIXES = ['<local-command-stdout>', '<local-command-stderr>', '<local-command-caveat>', '<system-reminder>', '<bash-stdout>', '<bash-stderr>'];

export interface TaskNotification {
  taskIds: string[];
  toolUseId: string | null;
  status: string;
  summary: string | null;
}

/** Parse `<task-notification>` blocks emitted when background agents finish. */
export function parseTaskNotifications(text: string): TaskNotification[] {
  const out: TaskNotification[] = [];
  const re = /<task-notification>([\s\S]*?)<\/task-notification>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[1] ?? '';
    const taskIds = [...body.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((x) => (x[1] ?? '').trim()).filter(Boolean);
    const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(body)?.[1]?.trim() ?? null;
    const status = /<status>([^<]+)<\/status>/.exec(body)?.[1]?.trim() ?? 'completed';
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1]?.trim() ?? null;
    out.push({ taskIds, toolUseId, status, summary });
  }
  return out;
}

export function notificationStatus(s: string): 'done' | 'error' {
  return /fail|error|kill/i.test(s) ? 'error' : 'done';
}

/**
 * Stateful parser for one transcript file. Feed it lines in order.
 * Pure: no I/O. Diffs are computed from `toolUseResult` when available.
 */
export class TranscriptParser {
  private readonly toolInputs = new Map<string, { name: string; input: Obj }>();
  private readonly toolNames = new Map<string, string>();
  private started = false;
  private lastText: string | null = null;
  private lastAt = 0;

  constructor(private readonly ctx: TranscriptContext) {}

  get context(): TranscriptContext {
    return this.ctx;
  }

  parseLine(line: string): NormalizedEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let o: Obj;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const p = obj(parsed);
      if (!p) return [];
      o = p;
    } catch {
      return [];
    }
    return this.parseObject(o);
  }

  parseObject(o: Obj): NormalizedEvent[] {
    const sessionId = str(o['sessionId']) ?? this.ctx.sessionId;
    // Metadata lines (titles, cost, mode…) have no timestamp: reuse the file's last one,
    // never "now", or reading an old file would make its session look active.
    const parsed = Date.parse(str(o['timestamp']) ?? '');
    if (parsed) this.lastAt = parsed;
    const at = parsed || this.lastAt || 0;
    const agentId = str(o['agentId']) ?? this.ctx.agentId ?? sessionId;
    const base = { sessionId, at, source: 'transcript' as const };
    const out: NormalizedEvent[] = [];
    const type = str(o['type']);

    if (!this.started && (type === 'user' || type === 'assistant' || type === 'system' || type === 'attachment')) {
      this.started = true;
      if (!this.ctx.agentId) {
        out.push({ ...base, kind: 'session.start', cwd: str(o['cwd']), transcriptPath: this.ctx.path ?? null });
      }
    }

    switch (type) {
      case 'custom-title': {
        const t = str(o['customTitle']);
        if (t) out.push({ ...base, kind: 'session.title', title: t, priority: 3 });
        break;
      }
      case 'ai-title': {
        const t = str(o['aiTitle']);
        if (t) out.push({ ...base, kind: 'session.title', title: t, priority: 2 });
        break;
      }
      case 'agent-name': {
        const t = str(o['agentName']);
        if (t && !this.ctx.agentId) out.push({ ...base, kind: 'session.title', title: t, priority: 1 });
        break;
      }
      case 'cost-state': {
        const c = o['totalCostUSD'];
        if (typeof c === 'number') out.push({ ...base, kind: 'session.cost', totalCostUSD: c });
        break;
      }
      case 'system': {
        if (o['subtype'] === 'compact_boundary') {
          const meta = obj(o['compactMetadata']);
          out.push({
            ...base,
            kind: 'compact',
            agentId,
            trigger: str(meta?.['trigger']),
            preTokens: typeof meta?.['preTokens'] === 'number' ? (meta['preTokens'] as number) : null,
          });
        }
        break;
      }
      case 'assistant':
        this.parseAssistant(o, base, agentId, out);
        break;
      case 'user':
        this.parseUser(o, base, agentId, out);
        break;
      default:
        break;
    }
    return out;
  }

  private parseAssistant(o: Obj, base: { sessionId: string; at: number; source: 'transcript' }, agentId: string, out: NormalizedEvent[]): void {
    const msg = obj(o['message']);
    if (!msg) return;
    const messageId = str(msg['id']) ?? str(o['requestId']) ?? str(o['uuid']);
    const model = str(msg['model']);
    const content = Array.isArray(msg['content']) ? (msg['content'] as unknown[]) : [];
    for (const b of content) {
      const block = obj(b);
      if (!block) continue;
      if (block['type'] === 'tool_use') {
        const id = str(block['id']);
        const name = str(block['name']) ?? 'tool';
        if (!id) continue;
        const input = obj(block['input']) ?? {};
        this.toolNames.set(id, name);
        if (EDIT_TOOLS.has(name)) this.toolInputs.set(id, { name, input });
        out.push({ ...base, kind: 'tool.start', agentId, toolUseId: id, name, input: truncateRecord(input), parentMessageId: messageId });
        if (READ_TOOLS.has(name)) {
          const path = filePathOf(input);
          if (path) out.push({ ...base, kind: 'file.change', change: makeReadChange({ id, sessionId: base.sessionId, agentId, at: base.at }, path) });
        }
        if (AGENT_TOOLS.has(name)) {
          out.push({
            ...base,
            kind: 'agent.spawn',
            parentAgentId: agentId,
            toolUseId: id,
            parentMessageId: messageId,
            agentType: str(input['subagent_type']) ?? 'general-purpose',
            description: str(input['description']) ?? '',
            prompt: truncateText(str(input['prompt']) ?? '', LIMITS.promptChars),
            model: str(input['model']),
            background: input['run_in_background'] === true,
          });
        }
      } else if (block['type'] === 'text') {
        const t = str(block['text']);
        if (t && t.trim()) {
          this.lastText = truncateText(t.trim(), 1000);
          out.push({ ...base, kind: 'assistant.text', agentId, text: this.lastText });
        }
      }
    }
    const usage = usageFromApi(msg['usage']);
    if (usage && messageId && o['isApiErrorMessage'] !== true) {
      out.push({ ...base, kind: 'usage', agentId, messageId, model, usage });
    }
    if (msg['stop_reason'] === 'end_turn') {
      out.push({ ...base, kind: 'turn.end', agentId, lastMessage: this.lastText });
    }
    if (o['isApiErrorMessage'] === true) {
      const t = content.map((b) => str(obj(b)?.['text'])).filter(Boolean).join(' ');
      out.push({ ...base, kind: 'error', agentId, message: truncateText(t || 'Erreur API', 500) });
    }
  }

  private parseUser(o: Obj, base: { sessionId: string; at: number; source: 'transcript' }, agentId: string, out: NormalizedEvent[]): void {
    if (o['isMeta'] === true) return;
    const msg = obj(o['message']);
    if (!msg) return;
    const content = msg['content'];
    const origin = obj(o['origin']);

    const promptText = (() => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content) && !content.some((b) => obj(b)?.['type'] === 'tool_result')) {
        return content
          .map((b) => str(obj(b)?.['text']))
          .filter(Boolean)
          .join('\n');
      }
      return null;
    })();

    if (promptText !== null) {
      if (origin?.['kind'] === 'task-notification' || promptText.trimStart().startsWith('<task-notification>')) {
        for (const n of parseTaskNotifications(promptText)) {
          for (const id of n.taskIds) {
            out.push({ ...base, kind: 'agent.stop', agentId: id, status: notificationStatus(n.status), lastMessage: n.summary });
          }
        }
        return;
      }
      // First line of a sub-agent transcript = the agent's prompt.
      if (this.ctx.agentId && o['parentUuid'] === null) {
        out.push({ ...base, kind: 'agent.start', agentId, prompt: truncateText(promptText, LIMITS.promptChars) });
        return;
      }
      if (origin && origin['kind'] !== undefined && origin['kind'] !== 'human') return;
      const t = promptText.trimStart();
      if (!t || NON_PROMPT_PREFIXES.some((p) => t.startsWith(p))) return;
      out.push({ ...base, kind: 'prompt', agentId, text: truncateText(promptText, 4000), promptId: str(o['promptId']) });
      return;
    }

    if (!Array.isArray(content)) return;
    const toolResults = content.map(obj).filter((b): b is Obj => !!b && b['type'] === 'tool_result');
    const structured = o['toolUseResult'];
    for (const tr of toolResults) {
      const id = str(tr['tool_use_id']);
      if (!id) continue;
      const name = this.toolNames.get(id) ?? null;
      const isError = tr['is_error'] === true;
      const text = stringifyOutput(tr['content']);
      out.push({ ...base, kind: 'tool.end', agentId, toolUseId: id, name, ok: !isError, output: isError ? null : text, error: isError ? text : null });

      const result = toolResults.length === 1 ? structured : undefined;
      const r = obj(result);
      if (name && AGENT_TOOLS.has(name) && r) {
        const childId = str(r['agentId']);
        if (childId) {
          out.push({ ...base, kind: 'agent.link', agentId: childId, toolUseId: id, model: str(r['resolvedModel']) });
          const status = str(r['status']);
          if (status && status !== 'async_launched' && status !== 'running') {
            out.push({ ...base, kind: 'agent.stop', agentId: childId, status: /error|fail/i.test(status) ? 'error' : 'done', lastMessage: null });
          }
        }
        if (isError && childId) out.push({ ...base, kind: 'agent.stop', agentId: childId, status: 'error', lastMessage: text });
      }
      const pending = this.toolInputs.get(id);
      if (pending && !isError) {
        const d = resolveFileDiff({ toolName: pending.name, input: pending.input, result });
        if (d) out.push({ ...base, kind: 'file.change', change: makeFileChange({ id, sessionId: base.sessionId, agentId, at: base.at }, d) });
      }
      this.toolInputs.delete(id);
    }
  }
}

/** Events derived from a `subagents/agent-<id>.meta.json` file. */
export function eventsFromAgentMeta(sessionId: string, agentId: string, meta: unknown, at: number): NormalizedEvent[] {
  const m = obj(meta);
  if (!m) return [];
  const toolUseId = str(m['toolUseId']);
  const evs: NormalizedEvent[] = [
    {
      sessionId,
      at,
      source: 'transcript',
      kind: 'agent.start',
      agentId,
      agentType: str(m['agentType']),
      description: str(m['description']),
      toolUseId,
    },
  ];
  if (toolUseId) evs.push({ sessionId, at, source: 'transcript', kind: 'agent.link', agentId, toolUseId });
  return evs;
}

/** Derive (sessionId, agentId) from a transcript path. */
export function identifyTranscript(path: string): { sessionId: string; agentId: string | null; kind: 'main' | 'subagent' | 'meta' } | null {
  const norm = path.replace(/\\/g, '/');
  const sub = /\/([0-9a-f-]{36})\/subagents\/agent-([^/]+?)\.(jsonl|meta\.json)$/i.exec(norm);
  if (sub) return { sessionId: sub[1] as string, agentId: sub[2] as string, kind: sub[3] === 'jsonl' ? 'subagent' : 'meta' };
  const main = /\/([0-9a-f-]{36})\.jsonl$/i.exec(norm);
  if (main) return { sessionId: main[1] as string, agentId: null, kind: 'main' };
  return null;
}
