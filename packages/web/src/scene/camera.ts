import type { Agent, FocusTarget, NarrationFocus, Workflow } from '@dash/shared';
import { roomKey, type RoomSlot } from './layout.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Critically damped spring step (Unity's SmoothDamp): smooth start and stop, retargetable mid-flight. */
export function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  return [target + (change + temp) * exp, (vel - omega * temp) * exp];
}

export interface FocusContext {
  sessionId: string;
  /** When the caption started (server clock, like agent timestamps). */
  since: number;
  rooms: RoomSlot[];
  /** The session's workflows, oldest first. */
  workflows: Workflow[];
  agents: Iterable<Agent>;
  agent: (id: string) => Agent | undefined;
}

function isActive(a: Agent | undefined): boolean {
  return !!a && (a.status === 'running' || a.status === 'starting');
}

/** The demo request expanded to a list of targets. */
function targetsOf(req: NarrationFocus, ctx: FocusContext): FocusTarget[] {
  switch (req.kind) {
    case 'group':
      return req.targets;
    case 'workflow': {
      const wf = ctx.workflows[req.index];
      return [{ kind: 'workflow', index: req.index }, ...(wf?.steps ?? []).map((_, i): FocusTarget => ({ kind: 'step', index: req.index, step: i + 1 }))];
    }
    case 'overview':
      return [{ kind: 'all' }];
    case 'surface':
      return [];
    default:
      return [req];
  }
}

/** Room keys one target designates (whether laid out or not). */
function targetKeys(t: FocusTarget, ctx: FocusContext): string[] {
  switch (t.kind) {
    case 'main':
      return [`main:${ctx.sessionId}`];
    case 'agent':
      return [`agent:${t.toolUseId}`];
    case 'workflow': {
      const wf = ctx.workflows[t.index];
      return wf ? [`wf:${wf.id}`] : [];
    }
    case 'step': {
      const wf = ctx.workflows[t.index];
      if (!wf) return [];
      const active = wf.steps.findIndex((s) => s.agentIds.some((id) => isActive(ctx.agent(id))));
      const st = t.step ? wf.steps[t.step - 1] : wf.steps[active >= 0 ? active : wf.steps.length - 1];
      return (st?.agentIds ?? []).flatMap((id) => {
        const a = ctx.agent(id);
        return a ? [roomKey(a)] : [];
      });
    }
    case 'spawned': {
      const out: string[] = [];
      for (const a of ctx.agents) if (a.sessionId === ctx.sessionId && a.kind === 'sub' && a.startedAt >= ctx.since - 250) out.push(roomKey(a));
      return out;
    }
    case 'all':
      return ctx.rooms.filter((r) => r.entity !== 'filler').map((r) => r.key);
  }
}

/**
 * Rooms a demo focus request designates, among those currently laid out. `complete` is false while
 * some target has no room yet (e.g. agents about to be spawned): the camera then waits for them
 * rather than framing part of the group and zooming out again a moment later.
 */
export function focusSlots(req: NarrationFocus, ctx: FocusContext): { slots: RoomSlot[]; complete: boolean } {
  const laidOut = new Set(ctx.rooms.map((r) => r.key));
  const keys = new Set<string>();
  let complete = true;
  for (const t of targetsOf(req, ctx)) {
    const found = targetKeys(t, ctx).filter((k) => laidOut.has(k));
    if (!found.length) complete = false;
    for (const k of found) keys.add(k);
  }
  return { slots: ctx.rooms.filter((r) => keys.has(r.key)), complete };
}

/** Closest zoom for a request: single rooms up close, groups and workflows wider. */
export function maxZoomFor(req: NarrationFocus): number {
  if (req.kind === 'group') return req.maxZoom ?? 3;
  return req.kind === 'main' || req.kind === 'agent' ? 3 : 2;
}

/**
 * Camera (world centre + zoom) that fits `rects` inside `safe` (the part of the screen not covered
 * by overlays). Takes the largest allowed zoom that fits; when even the smallest does not, the
 * top-left part of the group is shown.
 */
export function frameRects(rects: Rect[], maxZoom: number, screen: { w: number; h: number }, safe: Rect, steps: number[]): { x: number; y: number; zoom: number } {
  const pad = 14;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const R = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const zoom = steps.find((z) => z <= maxZoom && R.w * z <= safe.w && R.h * z <= safe.h) ?? (steps[steps.length - 1] as number);
  const x = R.w * zoom > safe.w ? R.x - (safe.x - screen.w / 2) / zoom : R.x + R.w / 2 - (safe.x + safe.w / 2 - screen.w / 2) / zoom;
  const y = R.h * zoom > safe.h ? R.y - (safe.y - screen.h / 2) / zoom : R.y + R.h / 2 - (safe.y + safe.h / 2 - screen.h / 2) / zoom;
  return { x, y, zoom };
}
