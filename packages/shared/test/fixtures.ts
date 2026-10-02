/**
 * Transcript line builders that mirror real Claude Code 2.1.288 lines
 * (structure copied from ~/.claude/projects, content redacted).
 */
export const SID = '0b5e7c3a-1d2f-4e6a-9b8c-7d6e5f4a3b2c';

let n = 0;
const ts = (sec: number) => new Date(Date.UTC(2026, 9, 2, 20, 52, sec)).toISOString();

const common = (sec: number, extra: Record<string, unknown> = {}) => ({
  parentUuid: null,
  isSidechain: false,
  uuid: `u-${++n}`,
  timestamp: ts(sec),
  userType: 'external',
  entrypoint: 'claude-desktop',
  cwd: '/home/dev/projects/demo-app',
  sessionId: SID,
  version: '2.1.288',
  gitBranch: 'HEAD',
  ...extra,
});

export const usage = (out: number, cacheRead = 40868) => ({
  input_tokens: 2,
  cache_creation_input_tokens: 51832,
  cache_read_input_tokens: cacheRead,
  output_tokens: out,
  output_tokens_details: { thinking_tokens: 137 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  cache_creation: { ephemeral_1h_input_tokens: 51832, ephemeral_5m_input_tokens: 0 },
});

/** One assistant message split over several lines (one per content block), same usage on each. */
export function assistantLines(
  sec: number,
  msgId: string,
  blocks: Array<Record<string, unknown>>,
  opts: { out?: number; stop?: string | null; agentId?: string; model?: string } = {},
): string[] {
  return blocks.map((b, i) =>
    JSON.stringify({
      ...common(sec, opts.agentId ? { agentId: opts.agentId, isSidechain: true } : {}),
      type: 'assistant',
      requestId: `req_${msgId}`,
      apiBlockIndex: i,
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: opts.model ?? 'claude-opus-5-5',
        content: [b],
        stop_reason: i === blocks.length - 1 ? (opts.stop ?? null) : null,
        usage: usage(opts.out ?? 300),
      },
    }),
  );
}

export function promptLine(sec: number, text: string, promptId = `p-${sec}`): string {
  return JSON.stringify({
    ...common(sec),
    promptId,
    type: 'user',
    message: { role: 'user', content: text },
    origin: { kind: 'human' },
    promptSource: 'sdk',
  });
}

export function toolResultLine(sec: number, toolUseId: string, content: unknown, toolUseResult: unknown, opts: { isError?: boolean; agentId?: string } = {}): string {
  return JSON.stringify({
    ...common(sec, opts.agentId ? { agentId: opts.agentId, isSidechain: true } : {}),
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content, ...(opts.isError ? { is_error: true } : {}) }] },
    toolUseResult,
    sourceToolAssistantUUID: 'a-x',
  });
}

export function taskNotificationLine(sec: number, agentId: string, toolUseId: string, status = 'completed'): string {
  return JSON.stringify({
    ...common(sec),
    promptId: `pn-${sec}`,
    type: 'user',
    message: {
      role: 'user',
      content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "x" finished</summary>\n</task-notification>`,
    },
    origin: { kind: 'task-notification', producer: 'session-task' },
    promptSource: 'system',
  });
}

export function subagentFirstLine(sec: number, agentId: string, prompt: string): string {
  return JSON.stringify({ ...common(sec, { agentId, isSidechain: true, promptId: 'px' }), type: 'user', message: { role: 'user', content: prompt } });
}

export const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
export const thinking = { type: 'thinking', thinking: '…', signature: 'sig' };
export const text = (t: string) => ({ type: 'text', text: t });
