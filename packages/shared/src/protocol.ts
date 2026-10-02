import type { Agent, FileChange, Session, ToolEvent, Workflow } from './types.ts';

export type EntityKind = 'session' | 'agent' | 'tool' | 'file' | 'workflow';

export interface EntityMap {
  session: Session;
  agent: Agent;
  tool: ToolEvent;
  file: FileChange;
  workflow: Workflow;
}

export type Upsert = { [K in EntityKind]: { op: 'upsert'; kind: K; data: EntityMap[K] } }[EntityKind];
export interface Removal {
  op: 'remove';
  kind: EntityKind;
  id: string;
}

export interface LogEntry {
  seq: number;
  at: number;
  source: string;
  sessionId: string;
  agentId: string | null;
  kind: string;
  summary: string;
  /** Severity for UI toasts. */
  level: 'info' | 'success' | 'warn' | 'error';
}

/** One SSE message: a batch of coalesced changes. */
export interface PatchBatch {
  seq: number;
  changes: Array<Upsert | Removal>;
  logs: LogEntry[];
}

export interface Snapshot {
  seq: number;
  serverStartedAt: number;
  sessions: Session[];
  agents: Agent[];
  tools: ToolEvent[];
  files: FileChange[];
  workflows: Workflow[];
  logs: LogEntry[];
}

export interface DashConfig {
  spriteSet: string;
  locale: string;
  version: string;
}
