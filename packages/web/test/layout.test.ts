import { describe, expect, it } from 'vitest';
import type { Agent, Workflow } from '@dash/shared';
import { computeLayout, levelTop, ROOM_X0 } from '../src/scene/layout.ts';
import { ROOM_H, ROOM_WIDTH } from '../src/scene/tiles.ts';

let n = 0;
function agent(p: Partial<Agent> & { id: string }): Agent {
  n++;
  return {
    sessionId: 'S',
    kind: 'sub',
    parentId: 'S',
    type: 'Explore',
    description: p.id,
    prompt: '',
    model: null,
    status: 'running',
    startedAt: n * 1000,
    endedAt: null,
    lastActivityAt: n * 1000,
    usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 },
    currentTool: null,
    currentToolInputPreview: null,
    spawnToolUseId: `tu-${p.id}`,
    parentMessageId: null,
    parentTurn: 1,
    background: false,
    workflowId: null,
    stepIndex: null,
    toolCount: 0,
    errorCount: 0,
    added: 0,
    removed: 0,
    files: {},
    lastMessage: null,
    turns: 0,
    contextTokens: 0,
    contextAt: 0,
    compactions: 0,
    todos: [],
    liveText: null,
    liveTextAt: 0,
    liveTextFinal: true,
    waiting: null,
    ...p,
  };
}

const main = agent({ id: 'S', kind: 'main', parentId: null, type: 'main' });

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('base layout', () => {
  it('main room first, at the top-left of level 0', () => {
    const l = computeLayout(main, [main], [], { compact: false, maxRowWidth: 1200 });
    expect(l.rooms[0]).toMatchObject({ kind: 'main', x: ROOM_X0, y: levelTop(0), level: 0 });
  });

  it('places every agent exactly once, without overlaps, wrapping rows', () => {
    const subs = Array.from({ length: 14 }, (_, i) => agent({ id: `a${i}`, status: i % 3 === 0 ? 'done' : 'running' }));
    const l = computeLayout(main, [main, ...subs], [], { compact: false, maxRowWidth: 1200 });
    const agentRooms = l.rooms.filter((r) => r.entity === 'agent');
    expect(agentRooms.map((r) => r.id).sort()).toEqual(['S', ...subs.map((s) => s.id)].sort());
    for (let i = 0; i < l.rooms.length; i++) for (let j = i + 1; j < l.rooms.length; j++) expect(overlaps(l.rooms[i]!, l.rooms[j]!)).toBe(false);
    expect(l.levels).toBeGreaterThan(1);
    for (const r of l.rooms) expect(r.x + r.w).toBeLessThanOrEqual(1200 + ROOM_WIDTH.agent);
    // done agents get compact rooms
    expect(agentRooms.find((r) => r.id === 'a0')?.kind).toBe('compact');
    expect(agentRooms.every((r) => r.h === ROOM_H)).toBe(true);
  });

  it('workflow: chief room, then one column per step with fillers in the holes', () => {
    const a = agent({ id: 'A' });
    const b = agent({ id: 'B' });
    const c = agent({ id: 'C' });
    const wf: Workflow = {
      id: 'wf1',
      sessionId: 'S',
      name: '#1',
      ownerAgentId: 'S',
      source: 'heuristic',
      startedAt: 1,
      steps: [
        { index: 1, agentIds: ['A', 'B'], startedAt: 1 },
        { index: 2, agentIds: ['C'], startedAt: 2 },
      ],
    };
    const l = computeLayout(main, [main, a, b, c], [wf], { compact: false, maxRowWidth: 1200 });
    const chief = l.rooms.find((r) => r.entity === 'workflow');
    expect(chief?.level).toBe(1);
    const ra = l.rooms.find((r) => r.id === 'A');
    const rb = l.rooms.find((r) => r.id === 'B');
    const rc = l.rooms.find((r) => r.id === 'C');
    expect(ra?.level).toBe(2);
    expect(rb?.level).toBe(3);
    expect(rc?.level).toBe(2);
    expect(rc!.x).toBeGreaterThan(ra!.x);
    // hole under C is a decor room
    expect(l.rooms.some((r) => r.entity === 'filler' && r.level === 3 && r.x === rc!.x)).toBe(true);
    expect(l.wires.filter((w) => w.type === 'feed')).toHaveLength(2);
    expect(l.wires.filter((w) => w.type === 'path')).toHaveLength(1);
    expect(l.ladders).toHaveLength(1);
    for (let i = 0; i < l.rooms.length; i++) for (let j = i + 1; j < l.rooms.length; j++) expect(overlaps(l.rooms[i]!, l.rooms[j]!)).toBe(false);
  });

  it('agents launched by a sub-agent sit next to their parent and get a link', () => {
    const p = agent({ id: 'P' });
    const other = agent({ id: 'O' });
    const child = agent({ id: 'K', parentId: 'P' });
    const l = computeLayout(main, [main, p, other, child], [], { compact: false, maxRowWidth: 4000 });
    const ids = l.rooms.filter((r) => r.entity === 'agent').map((r) => r.id);
    expect(ids.indexOf('K')).toBe(ids.indexOf('P') + 1);
    expect(l.links).toHaveLength(1);
  });

  it('room keys are stable across pending → real agent ids', () => {
    const pending = agent({ id: 't:tu-x', spawnToolUseId: 'tu-x' });
    const real = agent({ id: 'real-x', spawnToolUseId: 'tu-x' });
    const k1 = computeLayout(main, [main, pending], [], { compact: false, maxRowWidth: 1200 }).rooms[1]?.key;
    const k2 = computeLayout(main, [main, real], [], { compact: false, maxRowWidth: 1200 }).rooms[1]?.key;
    expect(k1).toBe(k2);
  });
});
