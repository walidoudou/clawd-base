import { hashString, type Agent, type Workflow } from '@dash/shared';
import { LEVEL, ROOM_H, ROOM_WIDTH, SLAB, FLOOR_Y, type FillerKind, type RoomKind } from './tiles.ts';

/** Horizontal metrics of the base (world pixels). */
export const SHAFT_X = 4;
export const SHAFT_W = 44;
export const ROOM_X0 = 56;
export const GAP = 8;
export const COL_GAP = 32;
/** Soil between the surface (y = 0) and the first level. */
export const TOPSOIL = 24;

export function levelTop(level: number): number {
  return TOPSOIL + level * LEVEL;
}

export interface RoomSlot {
  /** Stable key (survives pending→real agent re-keying). */
  key: string;
  kind: RoomKind;
  entity: 'agent' | 'workflow' | 'filler';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  level: number;
}

export interface Wire {
  key: string;
  workflowId: string;
  stepIndex: number;
  points: Array<{ x: number; y: number }>;
  /** 'feed' = chief → step column; 'path' = step → next step. */
  type: 'feed' | 'path';
}

/** Parent → child link for agents launched by sub-agents. */
export interface Link {
  key: string;
  from: string;
  to: string;
  points: Array<{ x: number; y: number }>;
}

export interface SceneLayout {
  rooms: RoomSlot[];
  wires: Wire[];
  links: Link[];
  /** Utility shafts (ladders) between workflow step columns. */
  ladders: Array<{ x: number; y: number; w: number; h: number }>;
  levels: number;
  /** Right edge of the excavated area. */
  width: number;
  bounds: { x: number; y: number; w: number; h: number };
}

const FILLERS: FillerKind[] = ['servers', 'storage', 'garden', 'generator', 'kitchen'];

export function roomKey(a: Agent): string {
  return a.kind === 'main' ? `main:${a.id}` : `agent:${a.spawnToolUseId ?? a.id}`;
}

function agentKind(a: Agent, compact: boolean): 'main' | 'agent' | 'compact' {
  if (a.kind === 'main') return 'main';
  return compact || a.status === 'done' ? 'compact' : 'agent';
}

function fillerKind(key: string): RoomKind {
  return `filler-${FILLERS[hashString(key) % FILLERS.length] as FillerKind}`;
}

/** Depth-first order so that agents launched by a sub-agent sit right after their parent. */
function treeOrder(agents: Agent[]): Agent[] {
  const ids = new Set(agents.map((a) => a.id));
  const children = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    if (a.parentId && ids.has(a.parentId)) {
      const arr = children.get(a.parentId) ?? [];
      arr.push(a);
      children.set(a.parentId, arr);
    } else roots.push(a);
  }
  const out: Agent[] = [];
  const visit = (a: Agent, depth: number) => {
    out.push(a);
    if (depth < 8) for (const c of children.get(a.id) ?? []) visit(c, depth + 1);
  };
  roots.forEach((r) => visit(r, 0));
  return out;
}

/**
 * Underground base layout. All rooms have the same height, so the base is a grid of levels:
 *  - level 0: main session room, then loose sub-agents (wrapping to the next levels);
 *  - then one block per workflow: the chief's room, and under it one column per step
 *    (step 1 | step 2 | …), each column stacking its agents one level apart.
 *    Holes in a block are filled with decor rooms (servers, storage, garden…).
 */
export function computeLayout(main: Agent | undefined, agents: Agent[], workflows: Workflow[], opts: { compact: boolean; maxRowWidth: number }): SceneLayout {
  const rooms: RoomSlot[] = [];
  const wires: Wire[] = [];
  const links: Link[] = [];
  const ladders: SceneLayout['ladders'] = [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const inWorkflow = new Set(workflows.flatMap((w) => w.steps.flatMap((s) => s.agentIds)));
  const maxRight = Math.max(opts.maxRowWidth, ROOM_X0 + ROOM_WIDTH.main + GAP + ROOM_WIDTH.agent);
  let level = 0;
  let x = ROOM_X0;
  let rowUsed = false;

  const place = (slot: Omit<RoomSlot, 'x' | 'y' | 'h' | 'level'>) => {
    if (rowUsed && x + slot.w > maxRight) {
      level++;
      x = ROOM_X0;
    }
    rooms.push({ ...slot, x, y: levelTop(level), h: ROOM_H, level });
    x += slot.w + GAP;
    rowUsed = true;
  };

  if (main) place({ key: roomKey(main), kind: 'main', entity: 'agent', id: main.id, w: ROOM_WIDTH.main });
  const loose = treeOrder(agents.filter((a) => a.kind === 'sub' && !inWorkflow.has(a.id)));
  for (const a of loose) {
    const kind = agentKind(a, opts.compact);
    place({ key: roomKey(a), kind, entity: 'agent', id: a.id, w: ROOM_WIDTH[kind] });
  }
  if (rowUsed) level++;

  for (const wf of workflows) {
    const chiefLevel = level;
    const cols = wf.steps.map((st) => {
      const items = st.agentIds.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
      const kinds = items.map((a) => agentKind(a, opts.compact));
      const w = Math.max(ROOM_WIDTH.compact, ...kinds.map((k) => ROOM_WIDTH[k]));
      return { st, items, kinds, w };
    });
    const depth = Math.max(1, ...cols.map((c) => c.items.length));
    const chief: RoomSlot = { key: `wf:${wf.id}`, kind: 'chief', entity: 'workflow', id: wf.id, x: ROOM_X0, y: levelTop(chiefLevel), w: ROOM_WIDTH.chief, h: ROOM_H, level: chiefLevel };
    rooms.push(chief);
    let cx = ROOM_X0;
    const colX: number[] = [];
    for (const c of cols) {
      colX.push(cx);
      cx += c.w + COL_GAP;
    }
    const colsRight = cols.length ? cx - COL_GAP : ROOM_X0;
    // Fill the rest of the chief's level with a decor room so the block reads as one wing.
    const chiefRight = chief.x + chief.w;
    if (colsRight - chiefRight - GAP >= ROOM_WIDTH.compact) {
      const key = `fill:${wf.id}:chief`;
      rooms.push({ key, kind: fillerKind(key), entity: 'filler', id: key, x: chiefRight + GAP, y: chief.y, w: colsRight - chiefRight - GAP, h: ROOM_H, level: chiefLevel });
    }
    const chiefBottom = { x: chief.x + Math.round(chief.w / 2), y: chief.y + ROOM_H };
    const duct = chief.y + ROOM_H + Math.round(SLAB / 2);
    cols.forEach((c, ci) => {
      const left = colX[ci] as number;
      for (let r = 0; r < depth; r++) {
        const lv = chiefLevel + 1 + r;
        const a = c.items[r];
        if (a) {
          const kind = c.kinds[r] as 'agent' | 'compact';
          const w = ROOM_WIDTH[kind];
          rooms.push({ key: roomKey(a), kind, entity: 'agent', id: a.id, x: left + Math.round((c.w - w) / 2), y: levelTop(lv), w, h: ROOM_H, level: lv });
        } else {
          const key = `fill:${wf.id}:${c.st.index}:${r}`;
          rooms.push({ key, kind: fillerKind(key), entity: 'filler', id: key, x: left, y: levelTop(lv), w: c.w, h: ROOM_H, level: lv });
        }
      }
      const colCenter = left + Math.round(c.w / 2);
      const colTop = levelTop(chiefLevel + 1);
      wires.push({
        key: `feed:${wf.id}:${c.st.index}`,
        workflowId: wf.id,
        stepIndex: c.st.index,
        type: 'feed',
        points: [chiefBottom, { x: chiefBottom.x, y: duct }, { x: colCenter, y: duct }, { x: colCenter, y: colTop + 6 }],
      });
      if (ci > 0) {
        const prev = cols[ci - 1];
        const prevRight = (colX[ci - 1] as number) + (prev?.w ?? 0);
        const y = colTop + FLOOR_Y - 26;
        wires.push({ key: `path:${wf.id}:${c.st.index}`, workflowId: wf.id, stepIndex: c.st.index, type: 'path', points: [{ x: prevRight - 4, y }, { x: left + 4, y }] });
        ladders.push({ x: prevRight, y: colTop, w: COL_GAP, h: depth * LEVEL - SLAB });
      }
    });
    level = chiefLevel + 1 + depth;
  }

  // Links between nested agents (sub-agent → its own sub-agents).
  const slotByAgent = new Map(rooms.filter((r) => r.entity === 'agent').map((r) => [r.id, r]));
  for (const a of agents) {
    if (a.kind !== 'sub' || !a.parentId) continue;
    const parent = byId.get(a.parentId);
    if (!parent || parent.kind !== 'sub') continue;
    const from = slotByAgent.get(parent.id);
    const to = slotByAgent.get(a.id);
    if (!from || !to) continue;
    const fx = from.x + Math.round(from.w / 2);
    const tx = to.x + Math.round(to.w / 2);
    const duct = from.y + ROOM_H + Math.round(SLAB / 2);
    const points =
      to.level === from.level
        ? [{ x: fx, y: from.y + ROOM_H }, { x: fx, y: duct }, { x: tx, y: duct }, { x: tx, y: to.y + ROOM_H }]
        : [{ x: fx, y: from.y + ROOM_H }, { x: fx, y: duct }, { x: tx, y: duct }, { x: tx, y: to.y }];
    links.push({ key: `link:${from.key}:${to.key}`, from: from.key, to: to.key, points });
  }

  let width = ROOM_X0;
  for (const r of rooms) width = Math.max(width, r.x + r.w);
  const levels = Math.max(1, level);
  const bottom = levelTop(levels);
  return { rooms, wires, links, ladders, levels, width, bounds: { x: 0, y: -90, w: width + 16, h: bottom + 90 } };
}
