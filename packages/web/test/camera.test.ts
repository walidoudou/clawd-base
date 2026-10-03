import { describe, expect, it } from 'vitest';
import type { Agent, Workflow } from '@dash/shared';
import { focusSlots, frameRects, smoothDamp, type FocusContext } from '../src/scene/camera.ts';
import { computeLayout } from '../src/scene/layout.ts';

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

const screen = { w: 1400, h: 760 };
const full = { x: 0, y: 0, w: 1400, h: 760 };
const STEPS = [3, 2.5, 2, 1.5, 1];

/** Screen position of a world point for a camera. */
function toScreen(cam: { x: number; y: number; zoom: number }, x: number, y: number) {
  return { x: screen.w / 2 + (x - cam.x) * cam.zoom, y: screen.h / 2 + (y - cam.y) * cam.zoom };
}

describe('camera framing', () => {
  const room = { x: 56, y: 24, w: 352, h: 128 };

  it('fits one room as close as allowed, centred in the part of the screen left visible', () => {
    const safe = { x: 0, y: 0, w: 1400, h: 520 }; // demo caption over the bottom 240 px
    const cam = frameRects([room], 3, screen, safe, STEPS);
    expect(cam.zoom).toBe(3);
    const c = toScreen(cam, room.x + room.w / 2, room.y + room.h / 2);
    expect(c.x).toBeCloseTo(700);
    expect(c.y).toBeCloseTo(260);
    // the whole room is above the caption
    expect(toScreen(cam, room.x, room.y + room.h).y).toBeLessThan(520);
  });

  it('zooms out for groups, using half steps when allowed', () => {
    // three explorers next to the main room
    const group = [{ x: 416, y: 24, w: 288, h: 128 }, { x: 712, y: 24, w: 288, h: 128 }, { x: 1008, y: 24, w: 288, h: 128 }];
    expect(frameRects(group, 3, screen, { x: 0, y: 0, w: 1400, h: 520 }, STEPS).zoom).toBe(1.5);
    expect(frameRects(group, 3, screen, { x: 0, y: 0, w: 1400, h: 520 }, [3, 2, 1]).zoom).toBe(1);
    expect(frameRects(group, 1, screen, full, STEPS).zoom).toBe(1);
  });

  it('shows the top-left part of a group too big for any zoom', () => {
    const tall = [room, { x: 56, y: 24 + 144 * 6, w: 352, h: 128 }];
    const cam = frameRects(tall, 3, screen, { x: 0, y: 0, w: 1400, h: 500 }, STEPS);
    expect(cam.zoom).toBe(1);
    expect(toScreen(cam, room.x, room.y - 14).y).toBeCloseTo(0);
  });

  it('springs to the target without overshoot, and retargets smoothly mid-flight', () => {
    let x = 0;
    let v = 0;
    let prev = 0;
    for (let i = 0; i < 60; i++) {
      [x, v] = smoothDamp(x, 1000, v, 0.33, 1 / 60);
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeLessThanOrEqual(1000);
      prev = x;
    }
    expect(x).toBeGreaterThan(980); // ~1 s
    // a new target while moving: no jump
    let y = 500;
    let vy = 800;
    const [y2] = smoothDamp(y, -200, vy, 0.33, 1 / 60);
    expect(Math.abs(y2 - y)).toBeLessThan(20);
    y = y2;
    expect(y).toBeGreaterThan(-200);
  });
});

describe('demo focus targets', () => {
  const main = agent({ id: 'S', kind: 'main', parentId: null, type: 'main', spawnToolUseId: null, startedAt: 0 });
  const e1 = agent({ id: 'e1', status: 'done', startedAt: 1000 });
  const e2 = agent({ id: 'e2', status: 'done', startedAt: 1000 });
  const i1 = agent({ id: 'i1', status: 'running', startedAt: 5000 });
  const wf: Workflow = {
    id: 'wf1',
    sessionId: 'S',
    name: '#1',
    ownerAgentId: 'S',
    source: 'heuristic',
    startedAt: 1000,
    steps: [
      { index: 1, agentIds: ['e1', 'e2'], startedAt: 1000 },
      { index: 2, agentIds: ['i1'], startedAt: 5000 },
    ],
  };
  const agents = [main, e1, e2, i1];
  const layout = computeLayout(main, agents, [wf], { compact: false, maxRowWidth: 1180 });
  const ctx = (since = 0): FocusContext => ({ sessionId: 'S', since, rooms: layout.rooms, workflows: [wf], agents, agent: (id) => agents.find((a) => a.id === id) });
  const keys = (r: { slots: Array<{ key: string }> }) => r.slots.map((s) => s.key).sort();

  it('resolves main, agents and workflow chiefs to their rooms', () => {
    expect(keys(focusSlots({ kind: 'main' }, ctx()))).toEqual(['main:S']);
    expect(keys(focusSlots({ kind: 'agent', toolUseId: 'tu-e2' }, ctx()))).toEqual(['agent:tu-e2']);
    expect(keys(focusSlots({ kind: 'group', targets: [{ kind: 'workflow', index: 0 }, { kind: 'step', index: 0, step: 1 }] }, ctx()))).toEqual(['agent:tu-e1', 'agent:tu-e2', 'wf:wf1']);
  });

  it('follows the running step, or the last one', () => {
    expect(keys(focusSlots({ kind: 'group', targets: [{ kind: 'step', index: 0 }] }, ctx()))).toEqual(['agent:tu-i1']);
    const doneCtx = { ...ctx(), agent: (id: string) => ({ ...agents.find((a) => a.id === id)!, status: 'done' as const }) };
    expect(keys(focusSlots({ kind: 'group', targets: [{ kind: 'step', index: 0 }] }, doneCtx))).toEqual(['agent:tu-i1']);
  });

  it('"spawned" means agents launched during the caption', () => {
    expect(keys(focusSlots({ kind: 'group', targets: [{ kind: 'main' }, { kind: 'spawned' }] }, ctx(4000)))).toEqual(['agent:tu-i1', 'main:S']);
  });

  it('targets that do not exist yet resolve to nothing (the camera waits)', () => {
    expect(focusSlots({ kind: 'group', targets: [{ kind: 'workflow', index: 1 }, { kind: 'step', index: 1 }] }, ctx())).toEqual({ slots: [], complete: false });
    expect(focusSlots({ kind: 'surface' }, ctx()).slots).toEqual([]);
  });

  it('a group is complete only once every target has a room (no zoom in, then out)', () => {
    // the parent exists, the agent it is about to launch does not yet
    const partial = focusSlots({ kind: 'group', targets: [{ kind: 'agent', toolUseId: 'tu-i1' }, { kind: 'spawned' }] }, ctx(9000));
    expect(keys(partial)).toEqual(['agent:tu-i1']);
    expect(partial.complete).toBe(false);
    expect(focusSlots({ kind: 'group', targets: [{ kind: 'agent', toolUseId: 'tu-i1' }, { kind: 'spawned' }] }, ctx(4000)).complete).toBe(true);
  });

  it('overview frames every real room, never the decor', () => {
    const { slots } = focusSlots({ kind: 'overview' }, ctx());
    expect(slots.length).toBe(5);
    expect(slots.every((s) => s.entity !== 'filler')).toBe(true);
  });
});
