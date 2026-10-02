import { describe, expect, it } from 'vitest';
import { detectWorkflows, nativeWorkflowName, parseWorkflowMarker, stripWorkflowMarker, type SpawnRecord } from '../src/workflow.ts';

const S = 'sess';
let k = 0;
function sp(p: Partial<SpawnRecord> & { at: number }): SpawnRecord {
  k++;
  return {
    agentId: p.agentId ?? `a${k}`,
    parentId: p.parentId ?? S,
    spawnToolUseId: p.spawnToolUseId ?? `toolu_${k}`,
    parentMessageId: p.parentMessageId ?? null,
    parentTurn: p.parentTurn ?? 1,
    startedAt: p.at,
    description: p.description ?? 'tâche',
    prompt: p.prompt ?? 'fais ceci',
  };
}

describe('parseWorkflowMarker', () => {
  it('parses name and optional step', () => {
    expect(parseWorkflowMarker('[workflow:refacto step:2] Revoir le module')).toEqual({ name: 'refacto', step: 2 });
    expect(parseWorkflowMarker('[Workflow: audit sécurité]')).toEqual({ name: 'audit sécurité', step: null });
    expect(parseWorkflowMarker('pas de marqueur')).toBeNull();
    expect(parseWorkflowMarker(undefined)).toBeNull();
  });
});

describe('stripWorkflowMarker', () => {
  it('removes markers for display', () => {
    expect(stripWorkflowMarker('[workflow:audit step:1] XSS')).toBe('XSS');
    expect(stripWorkflowMarker('Rien à retirer')).toBe('Rien à retirer');
  });
});

describe('nativeWorkflowName', () => {
  it('reads meta.name from a script', () => {
    expect(nativeWorkflowName({ script: "export const meta = {\n  name: 'review-changes',\n  description: 'x' }" })).toBe('review-changes');
    expect(nativeWorkflowName({ scriptPath: '/a/b/deploy.js' })).toBe('deploy');
  });
});

describe('detectWorkflows — heuristic', () => {
  it('a single parallel step is not a workflow', () => {
    const r = detectWorkflows(S, [sp({ at: 1, parentMessageId: 'm1' }), sp({ at: 2, parentMessageId: 'm1' })]);
    expect(r.workflows).toEqual([]);
    expect(r.assignment.size).toBe(0);
  });

  it('two assistant messages with Agent calls in the same turn = workflow with 2 steps', () => {
    const a = sp({ at: 1000, parentMessageId: 'm1', agentId: 'A' });
    const b = sp({ at: 1001, parentMessageId: 'm1', agentId: 'B' });
    const c = sp({ at: 9000, parentMessageId: 'm2', agentId: 'C' });
    const r = detectWorkflows(S, [c, a, b]);
    expect(r.workflows).toHaveLength(1);
    const wf = r.workflows[0];
    expect(wf?.source).toBe('heuristic');
    expect(wf?.name).toBe('#1');
    expect(wf?.steps.map((s) => s.agentIds)).toEqual([['A', 'B'], ['C']]);
    expect(r.assignment.get('C')).toEqual({ workflowId: wf?.id, stepIndex: 2 });
  });

  it('a new user turn starts a new run', () => {
    const r = detectWorkflows(S, [
      sp({ at: 1, parentMessageId: 'm1', parentTurn: 1 }),
      sp({ at: 5000, parentMessageId: 'm2', parentTurn: 2 }),
    ]);
    expect(r.workflows).toEqual([]);
  });

  it('without message ids (hooks only), clusters launches by time', () => {
    const r = detectWorkflows(S, [sp({ at: 0, agentId: 'A' }), sp({ at: 300, agentId: 'B' }), sp({ at: 10_000, agentId: 'C' })]);
    expect(r.workflows[0]?.steps.map((s) => s.agentIds)).toEqual([['A', 'B'], ['C']]);
  });

  it('workflow id is stable when message ids arrive later', () => {
    const hooksOnly = detectWorkflows(S, [sp({ at: 0, agentId: 'A', spawnToolUseId: 'tA' }), sp({ at: 9000, agentId: 'C', spawnToolUseId: 'tC' })]);
    const reconciled = detectWorkflows(S, [
      sp({ at: 0, agentId: 'A', spawnToolUseId: 'tA', parentMessageId: 'm1' }),
      sp({ at: 9000, agentId: 'C', spawnToolUseId: 'tC', parentMessageId: 'm2' }),
    ]);
    expect(hooksOnly.workflows[0]?.id).toBe(reconciled.workflows[0]?.id);
  });

  it('groups per parent agent', () => {
    const r = detectWorkflows(S, [
      sp({ at: 0, parentId: 'P1', parentMessageId: 'x1' }),
      sp({ at: 5000, parentId: 'P1', parentMessageId: 'x2' }),
      sp({ at: 0, parentId: 'P2', parentMessageId: 'y1' }),
    ]);
    expect(r.workflows.map((w) => w.ownerAgentId)).toEqual(['P1']);
  });
});

describe('detectWorkflows — explicit', () => {
  it('markers override the heuristic, even for a single step', () => {
    const r = detectWorkflows(S, [
      sp({ at: 0, agentId: 'A', description: '[workflow:migration step:1] schéma', parentMessageId: 'm1' }),
      sp({ at: 1, agentId: 'B', description: '[workflow:migration step:1] données', parentMessageId: 'm1' }),
    ]);
    expect(r.workflows).toHaveLength(1);
    expect(r.workflows[0]).toMatchObject({ name: 'migration', source: 'marker' });
    expect(r.workflows[0]?.steps).toHaveLength(1);
  });

  it('marker step numbers order steps; marker may be in the prompt', () => {
    const r = detectWorkflows(S, [
      sp({ at: 5, agentId: 'C', prompt: 'blabla [workflow:docs step:3]' }),
      sp({ at: 9, agentId: 'A', description: '[workflow:docs step:1] a' }),
    ]);
    expect(r.workflows[0]?.steps.map((s) => [s.index, s.agentIds])).toEqual([
      [1, ['A']],
      [3, ['C']],
    ]);
  });

  it('agents launched by a native Workflow tool call belong to it', () => {
    const r = detectWorkflows(
      S,
      [sp({ at: 100, agentId: 'A', spawnToolUseId: 'wf1' }), sp({ at: 150, agentId: 'B', spawnToolUseId: 'wf1' }), sp({ at: 9000, agentId: 'C', spawnToolUseId: 'wf1' })],
      [{ toolUseId: 'wf1', ownerAgentId: S, name: 'review', startedAt: 50 }],
    );
    expect(r.workflows[0]).toMatchObject({ source: 'native', name: 'review' });
    expect(r.workflows[0]?.steps.map((s) => s.agentIds)).toEqual([['A', 'B'], ['C']]);
  });
});
