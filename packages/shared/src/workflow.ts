import type { Workflow, WorkflowStep } from './types.ts';

/** Minimal view of a spawned sub-agent needed for workflow detection. */
export interface SpawnRecord {
  agentId: string;
  parentId: string;
  spawnToolUseId: string | null;
  parentMessageId: string | null;
  /** Number of human prompts the parent had seen when spawning. */
  parentTurn: number;
  startedAt: number;
  description: string;
  prompt: string;
}

/** A call to Claude Code's native `Workflow` tool. */
export interface NativeWorkflowCall {
  toolUseId: string;
  ownerAgentId: string;
  name: string;
  startedAt: number;
}

export interface WorkflowAssignment {
  workflowId: string;
  stepIndex: number;
}

export interface DetectionResult {
  workflows: Workflow[];
  assignment: Map<string, WorkflowAssignment>;
}

const MARKER_RE = /\[\s*workflow\s*:\s*([^\]\s][^\]]*?)(?:\s+step\s*:\s*(\d+))?\s*\]/i;

/** Parse `[workflow:<name> step:<n>]` (step optional). */
export function parseWorkflowMarker(text: string | null | undefined): { name: string; step: number | null } | null {
  if (!text) return null;
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  const name = (m[1] ?? '').trim();
  if (!name) return null;
  return { name, step: m[2] ? Number(m[2]) : null };
}

/** Remove `[workflow:… step:n]` markers from a label for display. */
export function stripWorkflowMarker(text: string): string {
  return text.replace(new RegExp(MARKER_RE.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
}

/** Extract `name` from a Workflow tool script's `export const meta = { name: '...' }`. */
export function nativeWorkflowName(input: Record<string, unknown>): string | null {
  const direct = input['name'];
  if (typeof direct === 'string' && direct) return direct;
  const script = input['script'];
  if (typeof script === 'string') {
    const m = /meta\s*=\s*\{[\s\S]*?name\s*:\s*['"`]([^'"`]+)['"`]/.exec(script);
    if (m?.[1]) return m[1];
  }
  const path = input['scriptPath'];
  if (typeof path === 'string') return path.split('/').pop()?.replace(/\.[jt]s$/, '') ?? null;
  return null;
}

/** Split records into groups where consecutive start times differ by more than `gapMs`. */
function clusterByTime<T extends { startedAt: number }>(items: T[], gapMs: number): T[][] {
  const sorted = [...items].sort((a, b) => a.startedAt - b.startedAt);
  const groups: T[][] = [];
  let last = -Infinity;
  for (const it of sorted) {
    if (it.startedAt - last > gapMs || groups.length === 0) groups.push([]);
    (groups[groups.length - 1] as T[]).push(it);
    last = it.startedAt;
  }
  return groups;
}

function stepsFromGroups(groups: SpawnRecord[][], firstIndex = 1): WorkflowStep[] {
  return groups.map((g, i) => ({
    index: firstIndex + i,
    agentIds: [...g].sort((a, b) => a.startedAt - b.startedAt).map((s) => s.agentId),
    startedAt: Math.min(...g.map((s) => s.startedAt)),
  }));
}

function stableId(prefix: string, records: SpawnRecord[]): string {
  const first = [...records].sort((a, b) => a.startedAt - b.startedAt)[0];
  return `wf:${prefix}:${first?.spawnToolUseId ?? first?.agentId ?? 'x'}`;
}

/**
 * Workflow detection rules (also documented in the README):
 *  1. Explicit markers `[workflow:<name> step:<n>]` in description/prompt win.
 *  2. Agents launched by a native `Workflow` tool call form that workflow;
 *     steps = launch-time clusters.
 *  3. Heuristic: sub-agent calls issued in the same assistant message = one step
 *     (parallel). Consecutive steps of the same parent within the same user turn
 *     form a run; a run of 2+ steps is a workflow.
 */
export function detectWorkflows(
  sessionId: string,
  spawns: SpawnRecord[],
  natives: NativeWorkflowCall[] = [],
  opts: { clusterMs?: number } = {},
): DetectionResult {
  const clusterMs = opts.clusterMs ?? 1500;
  const workflows: Workflow[] = [];
  const assignment = new Map<string, WorkflowAssignment>();
  const remaining: SpawnRecord[] = [];

  // 1. Markers
  const byMarker = new Map<string, { name: string; owner: string; items: Array<SpawnRecord & { step: number | null }> }>();
  for (const s of spawns) {
    const m = parseWorkflowMarker(s.description) ?? parseWorkflowMarker(s.prompt.slice(0, 2000));
    if (!m) {
      remaining.push(s);
      continue;
    }
    const key = `${s.parentId}\u0000${m.name.toLowerCase()}`;
    let g = byMarker.get(key);
    if (!g) byMarker.set(key, (g = { name: m.name, owner: s.parentId, items: [] }));
    g.items.push({ ...s, step: m.step });
  }
  for (const g of byMarker.values()) {
    const numbered = new Map<number, SpawnRecord[]>();
    const unnumbered: SpawnRecord[] = [];
    for (const it of g.items) {
      if (it.step !== null) {
        const arr = numbered.get(it.step) ?? [];
        arr.push(it);
        numbered.set(it.step, arr);
      } else unnumbered.push(it);
    }
    const steps: WorkflowStep[] = [...numbered.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, items]) => ({
        index: n,
        agentIds: items.sort((a, b) => a.startedAt - b.startedAt).map((x) => x.agentId),
        startedAt: Math.min(...items.map((x) => x.startedAt)),
      }));
    if (unnumbered.length) {
      const next = steps.length ? Math.max(...steps.map((s) => s.index)) + 1 : 1;
      steps.push(...stepsFromGroups(groupBySteps(unnumbered, clusterMs), next));
    }
    workflows.push({
      id: `wf:marker:${g.owner}:${g.name.toLowerCase()}`,
      sessionId,
      name: g.name,
      ownerAgentId: g.owner,
      source: 'marker',
      steps,
      startedAt: Math.min(...g.items.map((x) => x.startedAt)),
    });
  }

  // 2. Native Workflow tool
  const nativeById = new Map(natives.map((n) => [n.toolUseId, n]));
  const nativeGroups = new Map<string, SpawnRecord[]>();
  const rest: SpawnRecord[] = [];
  for (const s of remaining) {
    if (s.spawnToolUseId && nativeById.has(s.spawnToolUseId)) {
      const arr = nativeGroups.get(s.spawnToolUseId) ?? [];
      arr.push(s);
      nativeGroups.set(s.spawnToolUseId, arr);
    } else rest.push(s);
  }
  for (const n of natives) {
    const items = nativeGroups.get(n.toolUseId) ?? [];
    workflows.push({
      id: `wf:native:${n.toolUseId}`,
      sessionId,
      name: n.name,
      ownerAgentId: n.ownerAgentId,
      source: 'native',
      steps: stepsFromGroups(clusterByTime(items, clusterMs)),
      startedAt: n.startedAt,
    });
  }

  // 3. Heuristic
  const byParent = new Map<string, SpawnRecord[]>();
  for (const s of rest) {
    const arr = byParent.get(s.parentId) ?? [];
    arr.push(s);
    byParent.set(s.parentId, arr);
  }
  for (const [parentId, items] of byParent) {
    const steps = groupBySteps(items, clusterMs);
    // Split steps into runs: a new run starts when the parent's turn changes.
    const runs: SpawnRecord[][][] = [];
    let currentTurn: number | null = null;
    for (const step of steps) {
      const turn = step[0]?.parentTurn ?? 0;
      if (currentTurn === null || turn !== currentTurn) runs.push([]);
      (runs[runs.length - 1] as SpawnRecord[][]).push(step);
      currentTurn = turn;
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      const all = run.flat();
      workflows.push({
        id: stableId('h', all),
        sessionId,
        name: '',
        ownerAgentId: parentId,
        source: 'heuristic',
        steps: stepsFromGroups(run),
        startedAt: Math.min(...all.map((s) => s.startedAt)),
      });
    }
  }

  workflows.sort((a, b) => a.startedAt - b.startedAt);
  let n = 0;
  for (const wf of workflows) {
    if (wf.source === 'heuristic') wf.name = `#${++n}`;
    for (const st of wf.steps) for (const id of st.agentIds) assignment.set(id, { workflowId: wf.id, stepIndex: st.index });
  }
  return { workflows, assignment };
}

/**
 * Group spawns of one parent into steps: same parent assistant message id ⇒ same step.
 * Spawns without a message id (seen only via hooks so far) are clustered by launch time.
 */
export function groupBySteps(items: SpawnRecord[], clusterMs: number): SpawnRecord[][] {
  const withMsg = new Map<string, SpawnRecord[]>();
  const without: SpawnRecord[] = [];
  for (const s of items) {
    if (s.parentMessageId) {
      const arr = withMsg.get(s.parentMessageId) ?? [];
      arr.push(s);
      withMsg.set(s.parentMessageId, arr);
    } else without.push(s);
  }
  const groups = [...withMsg.values(), ...clusterByTime(without, clusterMs)];
  return groups.filter((g) => g.length > 0).sort((a, b) => Math.min(...a.map((x) => x.startedAt)) - Math.min(...b.map((x) => x.startedAt)));
}
