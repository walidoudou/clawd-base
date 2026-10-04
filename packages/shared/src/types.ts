/** Core data model shared by server and web. */

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number;
}

export type AgentStatus = 'starting' | 'running' | 'idle' | 'done' | 'error';
export type ToolStatus = 'running' | 'ok' | 'error';
export type FileOperation = 'read' | 'edit' | 'write' | 'create';

/** One diff hunk. `lines` are prefixed with ' ', '+' or '-'. Line numbers are 1-based; 0 = unknown. */
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileChange {
  /** = toolUseId of the tool call that produced it (one change per tool call). */
  id: string;
  sessionId: string;
  agentId: string;
  path: string;
  operation: FileOperation;
  at: number;
  hunks: Hunk[];
  added: number;
  removed: number;
  /** True when hunks were cut to respect memory caps. */
  truncated: boolean;
  /** Where the diff came from, for transparency in the UI. */
  diffSource: 'structuredPatch' | 'snapshot' | 'strings' | 'none';
}

/** A message of the conversation, shown live: sent, received, queued while Claude works, task done. */
export interface Message {
  id: string;
  sessionId: string;
  agentId: string;
  at: number;
  /** user = typed by the user (or the prompt of a sub-agent), assistant = Claude's reply, task = a task/todo done. */
  role: 'user' | 'assistant' | 'task';
  text: string;
  /**
   * sent: a normal prompt; queued: typed while Claude was busy, waiting; delivered: a queued message
   * Claude received (midTurn: inside the running turn); removed: taken out of the queue unanswered.
   */
  state: 'sent' | 'queued' | 'delivered' | 'removed';
  midTurn: boolean;
}

export interface ToolEvent {
  /** tool_use_id */
  id: string;
  sessionId: string;
  agentId: string;
  name: string;
  /** Tool input, with long strings truncated. */
  input: Record<string, unknown>;
  status: ToolStatus;
  startedAt: number;
  endedAt: number | null;
  output: string | null;
  error: string | null;
  /** File path if the tool targets a file. */
  filePath: string | null;
  /** Assistant message that issued the call (from transcripts). */
  parentMessageId: string | null;
  /** Execution time reported by Claude Code (hook `duration_ms`), else end − start. */
  durationMs: number | null;
  /** Tool call interrupted by the user (hook `is_interrupt`). */
  interrupted: boolean;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string | null;
}

export interface SessionTask {
  id: string;
  subject: string;
  description: string | null;
  status: 'pending' | 'completed';
  agentId: string | null;
  at: number;
}

export interface FileSummary {
  path: string;
  reads: number;
  edits: number;
  added: number;
  removed: number;
  lastOp: FileOperation;
  lastAt: number;
}

export interface Agent {
  /** Main agent id === sessionId. Sub-agent id = agentId from Claude Code (or `t:<toolUseId>` while pending). */
  id: string;
  sessionId: string;
  kind: 'main' | 'sub';
  /** Agent that launched it (null for main). */
  parentId: string | null;
  /** subagent_type, e.g. "Explore". "main" for the main thread. */
  type: string;
  description: string;
  prompt: string;
  model: string | null;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
  usage: TokenUsage;
  currentTool: string | null;
  currentToolInputPreview: string | null;
  /** tool_use_id of the Agent tool call that spawned it. */
  spawnToolUseId: string | null;
  /** Assistant message id in the parent where the spawn call lived. */
  parentMessageId: string | null;
  /** Prompt index (turn) of the parent when spawned. */
  parentTurn: number;
  background: boolean;
  workflowId: string | null;
  stepIndex: number | null;
  toolCount: number;
  errorCount: number;
  added: number;
  removed: number;
  files: Record<string, FileSummary>;
  lastMessage: string | null;
  /** Number of human prompts seen (main agent). */
  turns: number;
  /**
   * Context size of the latest assistant message: input + cache creation + cache read
   * (same formula Claude Code uses for its context indicator).
   */
  contextTokens: number;
  contextAt: number;
  /** Context window of this agent's model (1M for Opus 4.7+, Sonnet 5+, Fable; 200k otherwise). */
  contextWindow: number;
  /** Times the conversation was compacted. */
  compactions: number;
  /** Latest TodoWrite list. */
  todos: TodoItem[];
  /** Text being streamed right now (MessageDisplay hook, opt-in). */
  liveText: string | null;
  liveTextAt: number;
  liveTextFinal: boolean;
  /** Set when Claude waits for the user (permission prompt…); cleared on next activity. */
  waiting: string | null;
}

export interface WorkflowStep {
  index: number;
  agentIds: string[];
  startedAt: number;
}

export interface Workflow {
  id: string;
  sessionId: string;
  name: string;
  ownerAgentId: string;
  /** explicit = tagged by marker or native Workflow tool; heuristic otherwise. */
  source: 'marker' | 'native' | 'heuristic';
  steps: WorkflowStep[];
  startedAt: number;
}

export interface Session {
  id: string;
  title: string;
  cwd: string | null;
  project: string | null;
  transcriptPath: string | null;
  model: string | null;
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  status: 'active' | 'idle' | 'ended';
  /** Which sources contributed data. */
  sources: { hooks: boolean; transcript: boolean };
  lastPrompt: string | null;
  totalCostUSD: number | null;
  /** Tokens per minute: buckets[i] covers [start + i·60 s, start + (i+1)·60 s). Last 180 minutes. */
  usageTimeline: { start: number; buckets: number[] };
  /** Inferred context window (200k, or 1M once a context above 200k has been seen). */
  contextWindow: number;
  tasks: SessionTask[];
  /** What the session's usage went to, weighted like Claude Code's `/usage`. */
  usageShares: UsageShares;
  /** Breakdown written by the latest `/context` (system prompt, MCP tools, skills, messages…). */
  contextUsage: ContextUsage | null;
  /** Guided demo caption (only set by the built-in demo). */
  narration: Narration | null;
}

/**
 * Weighted usage (relative token prices × model tier, as in `/usage`), in total and per skill, sub-agent,
 * plugin and MCP server Claude Code attributed requests to. Divide by `total` for a share.
 */
export interface UsageShares {
  total: number;
  /** Requests made by sub-agents. */
  subagents: number;
  /** Requests sent with more than 150k tokens of context. */
  longContext: number;
  /** Requests with more than 100k uncached input tokens (cache miss). */
  cacheMiss: number;
  agents: Record<string, number>;
  skills: Record<string, number>;
  plugins: Record<string, number>;
  mcpServers: Record<string, number>;
}

export interface ContextUsage {
  at: number;
  total: number;
  window: number;
  /** Categories as `/context` names them, free space and buffer excluded. */
  categories: Array<{ name: string; tokens: number }>;
}

/** A room (or set of rooms) the guided demo camera can frame. */
export type FocusTarget =
  | { kind: 'main' }
  /** One sub-agent, by the tool_use id that spawned it. */
  | { kind: 'agent'; toolUseId: string }
  /** The chief's room of the session's n-th workflow (by start time). */
  | { kind: 'workflow'; index: number }
  /** The agents of one step of the n-th workflow (1-based); without `step`, the running (or last) step. */
  | { kind: 'step'; index: number; step?: number }
  /** Sub-agents launched since this narration started. */
  | { kind: 'spawned' }
  /** Every room of the session. */
  | { kind: 'all' };

export type NarrationFocus =
  | { kind: 'main' }
  | { kind: 'overview' }
  | { kind: 'surface' }
  | { kind: 'workflow'; index: number }
  | { kind: 'agent'; toolUseId: string }
  /** Frame all these rooms at once (re-evaluated as rooms appear, move or shrink). */
  | { kind: 'group'; targets: FocusTarget[]; maxZoom?: number };

export interface Narration {
  step: number;
  total: number;
  title: string;
  text: string;
  at: number;
  /** Where the camera should look while this caption is shown. */
  focus: NarrationFocus | null;
  done: boolean;
}

export const EMPTY_USAGE: TokenUsage = Object.freeze({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 });
