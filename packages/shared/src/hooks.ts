import type { NormalizedEvent } from './events.ts';
import { LIMITS, stringifyOutput, truncateRecord, truncateText } from './truncate.ts';
import { AGENT_TOOLS, notificationStatus, parseTaskNotifications } from './transcript.ts';
import { READ_TOOLS, filePathOf, makeReadChange } from './diff.ts';
import { parseTodos } from './store.ts';

type Obj = Record<string, unknown>;
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

/** Output of a PostToolUse payload, whatever the Claude Code version calls it. */
export function hookToolOutput(p: Obj): unknown {
  return p['tool_response'] ?? p['tool_output'] ?? p['tool_result'];
}

/**
 * Convert a raw hook stdin payload into normalized events.
 * File diffs for Edit/Write are computed by the server (needs disk access + snapshots).
 */
export function hookToEvents(payload: unknown, now: number = Date.now()): NormalizedEvent[] {
  const p = obj(payload);
  if (!p) return [];
  const sessionId = str(p['session_id']);
  const event = str(p['hook_event_name']);
  if (!sessionId || !event) return [];
  const agentId = str(p['agent_id']) ?? sessionId;
  const base = { sessionId, at: now, source: 'hook' as const };
  const out: NormalizedEvent[] = [];
  const toolName = str(p['tool_name']);
  const toolUseId = str(p['tool_use_id']);
  const input = obj(p['tool_input']) ?? {};

  switch (event) {
    case 'SessionStart':
      out.push({
        ...base,
        kind: 'session.start',
        cwd: str(p['cwd']),
        transcriptPath: str(p['transcript_path']),
        model: str(p['model']),
        title: str(p['session_title']),
      });
      if (str(p['session_title'])) out.push({ ...base, kind: 'session.title', title: str(p['session_title']) as string, priority: 2 });
      break;
    case 'SessionEnd':
      out.push({ ...base, kind: 'session.end' });
      break;
    case 'UserPromptSubmit': {
      const text = str(p['prompt']);
      // Background-agent completions are injected as prompts (source "system"); they are not human input.
      if (text && (p['source'] === 'system' || text.trimStart().startsWith('<task-notification>'))) {
        for (const n of parseTaskNotifications(text)) {
          for (const id of n.taskIds) out.push({ ...base, kind: 'agent.stop', agentId: id, status: notificationStatus(n.status), lastMessage: n.summary });
        }
        break;
      }
      if (text) out.push({ ...base, kind: 'prompt', agentId, text: truncateText(text, 4000), promptId: str(p['prompt_id']) });
      break;
    }
    case 'PreToolUse':
      if (!toolName || !toolUseId) break;
      out.push({ ...base, kind: 'tool.start', agentId, toolUseId, name: toolName, input: truncateRecord(input), parentMessageId: null });
      if (toolName === 'TodoWrite') {
        const todos = parseTodos(input['todos']);
        if (todos) out.push({ ...base, kind: 'todos', agentId, todos });
      }
      if (READ_TOOLS.has(toolName)) {
        const path = filePathOf(input);
        if (path) out.push({ ...base, kind: 'file.change', change: makeReadChange({ id: toolUseId, sessionId, agentId, at: now }, path) });
      }
      if (AGENT_TOOLS.has(toolName)) {
        out.push({
          ...base,
          kind: 'agent.spawn',
          parentAgentId: agentId,
          toolUseId,
          parentMessageId: null,
          agentType: str(input['subagent_type']) ?? 'general-purpose',
          description: str(input['description']) ?? '',
          prompt: truncateText(str(input['prompt']) ?? '', LIMITS.promptChars),
          model: str(input['model']),
          background: input['run_in_background'] === true,
        });
      }
      break;
    case 'PostToolUse': {
      if (!toolUseId) break;
      const output = hookToolOutput(p);
      out.push({ ...base, kind: 'tool.end', agentId, toolUseId, name: toolName, ok: true, output: stringifyOutput(output), error: null, durationMs: num(p['duration_ms']) });
      const r = obj(output);
      if (toolName && AGENT_TOOLS.has(toolName) && r) {
        const childId = str(r['agentId']);
        if (childId) {
          out.push({ ...base, kind: 'agent.link', agentId: childId, toolUseId, model: str(r['resolvedModel']) });
          const status = str(r['status']);
          if (status && status !== 'async_launched' && status !== 'running') {
            out.push({ ...base, kind: 'agent.stop', agentId: childId, status: /error|fail/i.test(status) ? 'error' : 'done' });
          }
        }
      }
      break;
    }
    case 'PostToolUseFailure':
      if (!toolUseId) break;
      out.push({
        ...base,
        kind: 'tool.end',
        agentId,
        toolUseId,
        name: toolName,
        ok: false,
        output: null,
        // Real schema (2.1.288): `error` + `is_interrupt`; docs mention `error_message`.
        error: truncateText(str(p['error']) ?? str(p['error_message']) ?? 'Échec', LIMITS.toolOutputChars),
        durationMs: num(p['duration_ms']),
        interrupted: p['is_interrupt'] === true,
      });
      break;
    case 'SubagentStart': {
      const id = str(p['agent_id']);
      if (id) out.push({ ...base, kind: 'agent.start', agentId: id, agentType: str(p['agent_type']) });
      break;
    }
    case 'SubagentStop': {
      const id = str(p['agent_id']);
      if (id) out.push({ ...base, kind: 'agent.stop', agentId: id, status: 'done', lastMessage: truncateText(str(p['last_assistant_message']) ?? '', 1000) || null, agentType: str(p['agent_type']) });
      break;
    }
    case 'Stop':
      out.push({ ...base, kind: 'turn.end', agentId, lastMessage: truncateText(str(p['last_assistant_message']) ?? '', 1000) || null });
      break;
    case 'StopFailure': {
      const kind = str(p['error']) ?? str(p['error_type']) ?? 'erreur';
      const details = str(p['error_details']) ?? str(p['error_message']) ?? '';
      out.push({ ...base, kind: 'error', agentId, message: truncateText(`${kind}${details ? `: ${details}` : ''}`, 500) });
      break;
    }
    case 'Notification': {
      const message = str(p['message']);
      const type = str(p['notification_type']);
      if (!message) break;
      if (type === 'permission_prompt' || type === 'agent_needs_input' || type === 'elicitation_dialog' || type === 'elicitation_url_dialog') {
        out.push({ ...base, kind: 'attention', agentId, message: truncateText(message, 300), notificationType: type });
      } else {
        out.push({ ...base, kind: 'notification', message: truncateText(message, 500), notificationType: type });
      }
      break;
    }
    case 'TaskCreated':
    case 'TaskCompleted': {
      const taskId = str(p['task_id']);
      if (!taskId) break;
      out.push({
        ...base,
        kind: 'task',
        agentId: str(p['agent_id']),
        taskId,
        subject: str(p['task_subject']) ?? str(p['task_title']) ?? taskId,
        description: str(p['task_description']),
        status: event === 'TaskCompleted' ? 'completed' : 'pending',
      });
      break;
    }
    case 'MessageDisplay': {
      const messageId = str(p['message_id']);
      if (!messageId) break;
      out.push({ ...base, kind: 'live.text', agentId, messageId, index: num(p['index']) ?? 0, delta: str(p['delta']) ?? '', final: p['final'] === true });
      break;
    }
    case 'PreCompact':
      break;
    case 'PostCompact':
      out.push({ ...base, kind: 'compact', agentId, trigger: str(p['trigger']) ?? str(p['compact_trigger']), preTokens: num(p['tokens_before']) });
      break;
    case 'PostModelSwitch':
      // Model is picked up per message from transcripts; nothing to do.
      break;
    default:
      break;
  }
  return out;
}

/** Tools whose PreToolUse triggers a server-side file snapshot. */
export const SNAPSHOT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
