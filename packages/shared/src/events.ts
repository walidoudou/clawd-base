import type { FileChange, Narration, TodoItem, TokenUsage } from './types.ts';

/**
 * Normalized event stream. Both hook payloads and transcript lines are converted
 * to these events; the StateStore reduces them idempotently, so the same fact
 * arriving from both sources (or replayed) is harmless.
 */
export type EventSource = 'hook' | 'transcript' | 'sim' | 'server';

interface Base {
  sessionId: string;
  at: number;
  source: EventSource;
}

export type NormalizedEvent =
  | (Base & { kind: 'session.start'; cwd?: string | null; transcriptPath?: string | null; model?: string | null; title?: string | null })
  | (Base & { kind: 'session.title'; title: string; priority: number })
  | (Base & { kind: 'session.end' })
  | (Base & { kind: 'session.cost'; totalCostUSD: number })
  | (Base & { kind: 'prompt'; agentId: string; text: string; promptId: string | null })
  | (Base & {
      kind: 'agent.spawn';
      parentAgentId: string;
      toolUseId: string;
      parentMessageId: string | null;
      agentType: string;
      description: string;
      prompt: string;
      model: string | null;
      background: boolean;
    })
  | (Base & {
      kind: 'agent.start';
      agentId: string;
      agentType?: string | null;
      toolUseId?: string | null;
      description?: string | null;
      prompt?: string | null;
    })
  | (Base & { kind: 'agent.link'; agentId: string; toolUseId: string; model?: string | null })
  | (Base & { kind: 'agent.stop'; agentId: string; status: 'done' | 'error'; lastMessage?: string | null; agentType?: string | null })
  | (Base & {
      kind: 'tool.start';
      agentId: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      parentMessageId: string | null;
    })
  | (Base & {
      kind: 'tool.end';
      agentId: string;
      toolUseId: string;
      name: string | null;
      ok: boolean;
      output: string | null;
      error: string | null;
      durationMs?: number | null;
      interrupted?: boolean;
    })
  | (Base & { kind: 'usage'; agentId: string; messageId: string; model: string | null; usage: TokenUsage })
  | (Base & { kind: 'assistant.text'; agentId: string; text: string })
  | (Base & { kind: 'turn.end'; agentId: string; lastMessage?: string | null })
  | (Base & { kind: 'file.change'; change: FileChange })
  | (Base & { kind: 'notification'; message: string; notificationType: string | null })
  | (Base & { kind: 'error'; agentId: string; message: string })
  | (Base & { kind: 'todos'; agentId: string; todos: TodoItem[] })
  | (Base & { kind: 'live.text'; agentId: string; messageId: string; index: number; delta: string; final: boolean })
  | (Base & { kind: 'compact'; agentId: string; trigger: string | null; preTokens: number | null })
  | (Base & { kind: 'task'; agentId: string | null; taskId: string; subject: string; description: string | null; status: 'pending' | 'completed' })
  | (Base & { kind: 'attention'; agentId: string; message: string; notificationType: string | null })
  | (Base & { kind: 'narration'; narration: Narration });

export type EventKind = NormalizedEvent['kind'];
