import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { animationFor, formatTokens, mulberry32, type Agent, type Anim, type NarrationFocus, type Workflow } from '@dash/shared';
import { t } from '../i18n/index.ts';
import { activeStepIndex, agentLabel, data, isActive, isArchived, mascotSeed, sessionAgents, sessionWorkflows, useDash } from '../state.ts';
import { basename, formatDuration, modelBadge, preview } from '../format.ts';
import { toolCategory, toolDisplayName } from '../tools.ts';
import { computeLayout, levelTop, ROOM_X0, SHAFT_W, SHAFT_X, type SceneLayout, type Wire } from './layout.ts';
import { focusSlots, frameRects, maxZoomFor, smoothDamp } from './camera.ts';
import { RoomView, type BoardLine, type RoomInfo, type StepBox } from './Room.ts';
import { dirtTexture, elevatorTexture, grassTexture, hutTexture, releaseSeed, rockTexture, treeTexture, type PropKind } from './textures.ts';
import { ROOM_H, SLAB, type FillerKind, type Stations } from './tiles.ts';
import { ParticleSystem } from './particles.ts';

const STATUS_COLOR: Record<string, string> = { starting: '#6cc4ff', running: '#6cc4ff', idle: '#b9a8d6', done: '#7ee08f', error: '#ff6b6b' };
const C = { text: 0xe8f0e0, muted: 0x9fb39f, tool: 0x6cc4ff, read: 0xc4d9ff, edit: 0xffd479, prompt: 0xd8cfe6, warn: 0xffd479, todo: 0xb5e48c };

export interface FocusRect {
  key: string;
  entity: 'agent' | 'workflow';
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Camera request coming from the guided demo narration. */
export type FocusRequest = NarrationFocus;

/** Screen margins covered by overlays (demo caption, side panel), in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MinimapData {
  bounds: { x: number; y: number; w: number; h: number };
  rooms: Array<{ x: number; y: number; w: number; h: number; color: string }>;
  view: { x: number; y: number; w: number; h: number };
}

/** Greedy word wrap to lines of at most `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (word.length > width) {
      if (cur) lines.push(cur);
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      cur = '';
      continue;
    }
    if ((cur ? cur.length + 1 : 0) + word.length > width) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Where the mascot goes and what it holds, from the current tool. */
function activityOf(a: Agent, anim: Anim): { station: keyof Stations; prop: PropKind | 'none' } {
  if (a.status === 'done' || a.status === 'idle') return { station: 'rest', prop: 'none' };
  if (a.status === 'error') return { station: 'desk', prop: 'none' };
  if (!a.currentTool) return { station: 'board', prop: anim === 'think' ? 'bubble' : 'none' };
  switch (toolCategory(a.currentTool)) {
    case 'edit':
      return { station: 'desk', prop: 'keyboard' };
    case 'read':
      return { station: 'read', prop: 'scroll' };
    case 'bash':
      return { station: 'bash', prop: 'none' };
    case 'agent':
      return { station: 'board', prop: 'none' };
    default:
      return { station: 'board', prop: 'bubble' };
  }
}

/** Sky colours by local hour (kept dark and cozy). */
function skyColors(hour: number): [number, number] {
  if (hour >= 21 || hour < 5) return [0x070a1c, 0x251a3d];
  if (hour < 7) return [0x141a40, 0x8a4a6a];
  if (hour < 18) return [0x1a3a6a, 0x5a7aa8];
  return [0x1b1d48, 0xa0506a];
}

function lerpColor(a: number, b: number, k: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

type Star = Sprite & { phase: number };

/**
 * The PixiJS underground base: sky, surface, rock, levels of rooms, an elevator,
 * workflow cables and a smooth integer-zoom camera.
 */
export class BaseScene {
  readonly app = new Application();
  // screen space
  private readonly sky = new Graphics();
  private readonly stars = new Container();
  // world space
  private readonly world = new Container();
  private readonly ground = new Container();
  private readonly structure = new Graphics();
  private readonly cablesG = new Graphics();
  private readonly roomsLayer = new Container();
  private readonly cab = new Sprite();
  private readonly antennaLight = new Graphics();
  private readonly fxLayer = new Container();
  private readonly fx = new ParticleSystem(this.fxLayer);
  private readonly fireflies = new Container();
  private readonly meteor = new Graphics();
  private readonly landingLight = new Graphics();
  /** Transition tracking for one-shot celebrations (only after the first sync of a session). */
  private seenSession: string | null = null;
  private readonly wasEnded = new Map<string, boolean>();
  private readonly wasWfDone = new Map<string, boolean>();
  private readonly stepAgents = new Map<string, Set<string>>();
  private readonly wireFlashUntil = new Map<string, number>();
  private readonly packets: Array<{ wire: string; start: number }> = [];
  private fireworksUntil = 0;
  private nextRocket = 0;
  private nextMeteor = performance.now() + 8000;
  private meteorState: { x: number; y: number; vx: number; vy: number; start: number } | null = null;
  private cabMoving = false;
  private landingUntil = 0;
  /** Guided demo: what the camera keeps framing until the next caption or a user gesture. */
  private track: { req: FocusRequest; since: number; setAt: number; zoomCap: number; applied: boolean } | null = null;
  /** Overlays covering the canvas (set by the React wrapper). */
  insets: () => Insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
  private readonly rooms = new Map<string, RoomView>();
  private layout: SceneLayout | null = null;
  private layoutSig = '';
  private groundSig = '';
  private readonly wireState = new Map<string, 'pending' | 'active' | 'done'>();
  zoom = 2;
  private camX = 0;
  private camY = 0;
  /** Camera animation target (null = at rest) and spring velocities. */
  private camTX: number | null = null;
  private camTY: number | null = null;
  private zoomT: number | null = null;
  private velX = 0;
  private velY = 0;
  private velZ = 0;
  private lastTickAt = performance.now();
  private lastCamEmit = 0;
  /** Zoom the room texts are rasterised for. */
  private textZoom = 2;
  private dragging: { x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
  private suppressTap = false;
  compactForced = false;
  follow = false;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  /** Pixi is initialised (app.screen/renderer exist). Data may arrive before that. */
  private ready = false;
  private lastSync = 0;
  private syncQueued = false;
  private centeredFor: string | null = null;
  private readonly fpsAcc = { frames: 0, since: performance.now(), fps: 60 };
  private skyHour = -1;
  private cabY = 0;
  private cabTargetY = 0;
  private antennaUntil = 0;
  private activeRoomKey: string | null = null;
  private lastMinimap = 0;
  onFocusRects: (rects: FocusRect[]) => void = () => {};
  onFps: (fps: number) => void = () => {};
  onMinimap: (m: MinimapData) => void = () => {};

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: '#0b0f1e', antialias: false, roundPixels: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    if (this.destroyed) {
      // Unmounted while initialising: tear down here, now that the renderer exists (no leaked GL context).
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    // Pixi only follows window resizes; the host also changes when the HUD wraps or panels open.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.ready && !this.destroyed) this.app.resize();
    });
    this.resizeObserver.observe(host);
    this.app.stage.addChild(this.sky, this.stars, this.meteor, this.world);
    this.world.addChild(this.ground, this.fireflies, this.structure, this.cablesG, this.roomsLayer, this.cab, this.landingLight, this.antennaLight, this.fxLayer);
    this.makeFireflies();
    this.cab.texture = elevatorTexture();
    this.makeStars();
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.bindInput();
    this.app.ticker.add(() => this.tick());
    this.app.renderer.on('resize', () => {
      this.drawSky(true);
      this.applyCamera();
      // The visible area changed (window, HUD wrapping): re-frame what the demo is showing.
      this.requestSync();
    });
    this.zoom = this.textZoom = window.innerWidth > 2200 ? 3 : 2;
    this.ready = true;
    this.drawSky(true);
    this.requestSync();
  }

  destroy(): void {
    const wasReady = this.ready;
    this.destroyed = true;
    this.ready = false;
    this.resizeObserver?.disconnect();
    // If init() is still pending it will destroy the app itself once the renderer exists.
    if (!wasReady) return;
    for (const r of this.rooms.values()) if (r.seed) releaseSeed(r.seed);
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* already destroyed */
    }
  }

  /** Blink the surface antenna (called on every data batch). */
  pulse(): void {
    this.antennaUntil = performance.now() + 220;
  }

  // ───────────── sky & surface ─────────────

  private drawSky(force = false): void {
    const hour = new Date().getHours();
    if (!force && hour === this.skyHour) return;
    this.skyHour = hour;
    const [top, bottom] = skyColors(hour);
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.sky.clear();
    const bands = 24;
    for (let i = 0; i < bands; i++) this.sky.rect(0, Math.floor((i * h) / bands), w, Math.ceil(h / bands) + 1).fill(lerpColor(top, bottom, i / (bands - 1)));
    const mx = Math.floor(w * 0.82);
    this.sky.rect(mx, 40, 14, 14).fill(0xf4e9c1);
    this.sky.rect(mx - 2, 42, 18, 10).fill(0xf4e9c1);
    this.sky.rect(mx + 4, 44, 3, 3).fill(0xd8cca0);
  }

  private makeStars(): void {
    const rng = mulberry32(42);
    for (let i = 0; i < 90; i++) {
      const s = new Sprite(Texture.WHITE) as Star;
      const size = rng() < 0.15 ? 2 : 1;
      s.width = size;
      s.height = size;
      s.tint = rng() < 0.2 ? 0xffe7a3 : 0xe8e6ff;
      s.position.set(Math.floor(rng() * 2400), Math.floor(rng() * 700));
      s.alpha = 0.4 + rng() * 0.6;
      s.phase = rng() * Math.PI * 2;
      this.stars.addChild(s);
    }
  }

  private makeFireflies(): void {
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(Texture.WHITE) as Star;
      s.width = 1;
      s.height = 1;
      s.tint = 0xd8ff8a;
      s.phase = Math.random() * 1000;
      this.fireflies.addChild(s);
    }
  }

  /**
   * Guided demo: frame something until the next caption. Rooms are resolved on every sync, so the
   * camera waits for rooms that do not exist yet and follows them when the base reshuffles.
   */
  setFocus(req: FocusRequest | null, since = Date.now()): void {
    this.track = req ? { req, since, setAt: performance.now(), zoomCap: Infinity, applied: false } : null;
    this.requestSync();
  }

  /** Zoom levels the camera may use: half steps stay pixel-perfect on 2× screens. */
  private zoomSteps(): number[] {
    return (window.devicePixelRatio || 1) >= 2 ? [3, 2.5, 2, 1.5, 1] : [3, 2, 1];
  }

  private safeArea(): { x: number; y: number; w: number; h: number } {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const i = this.insets();
    const w = Math.max(160, sw - i.left - i.right);
    const h = Math.max(120, sh - i.top - i.bottom);
    return { x: Math.min(i.left, sw - w), y: Math.min(i.top, sh - h), w, h };
  }

  /** Re-aim the camera at the tracked rooms (called on every sync: rooms appear, move and shrink). */
  private updateTracking(layout: SceneLayout, sessionId: string): void {
    const tr = this.track;
    if (!tr) return;
    if (tr.req.kind === 'surface') {
      // Sky and first level: the fireworks go off above the hut.
      if (tr.applied) return;
      tr.applied = true;
      const f = frameRects([{ x: SHAFT_X - 60, y: -230, w: 760, h: 270 }], 2, { w: this.app.screen.width, h: this.app.screen.height }, this.safeArea(), this.zoomSteps());
      this.animateTo(f.x, f.y, f.zoom);
      return;
    }
    const { slots, complete } = focusSlots(tr.req, { sessionId, since: tr.since, rooms: layout.rooms, workflows: sessionWorkflows(sessionId), agents: data.agents.values(), agent: (id) => data.agents.get(id) });
    // Rooms not built yet: stay put and retry on the next sync (frame what exists after a while).
    if (!slots.length || (!complete && !tr.applied && performance.now() - tr.setAt < 2500)) return;
    // Never zoom back in during one caption: rooms shrinking when done would make the camera pump.
    const screen = { w: this.app.screen.width, h: this.app.screen.height };
    const f = frameRects(slots, Math.min(maxZoomFor(tr.req), tr.zoomCap), screen, this.safeArea(), this.zoomSteps());
    tr.zoomCap = f.zoom;
    tr.applied = true;
    const cx = this.camTX ?? this.camX;
    const cy = this.camTY ?? this.camY;
    const cz = this.zoomT ?? this.zoom;
    if (Math.abs(f.x - cx) < 2 && Math.abs(f.y - cy) < 2 && f.zoom === cz) return;
    this.animateTo(f.x, f.y, f.zoom);
  }

  /** A user gesture takes the camera back from the guided demo (until its next caption). */
  private userCamera(): void {
    this.track = null;
    this.camTX = this.camTY = this.zoomT = null;
    this.velX = this.velY = this.velZ = 0;
  }

  private buildGround(layout: SceneLayout): void {
    for (const c of this.ground.removeChildren()) c.destroy();
    const left = -3000;
    const right = layout.width + 3000;
    const bottom = levelTop(layout.levels) + 2400;
    const rng = mulberry32(5);
    const hills = new Graphics();
    for (let x = left; x < right; x += 8) {
      const hgt = 18 + Math.round(14 * Math.sin(x / 140) + 8 * Math.sin(x / 47) + rng() * 2);
      hills.rect(x, -hgt, 8, hgt).fill(0x15122a);
    }
    this.ground.addChild(hills);
    for (let x = left + 200; x < right - 200; x += 70 + Math.floor(rng() * 90)) {
      if (x > SHAFT_X - 80 && x < SHAFT_X + SHAFT_W + 70) continue;
      const tex = treeTexture(Math.floor(rng() * 1000));
      const s = new Sprite(tex);
      s.position.set(x, -tex.height + 2);
      this.ground.addChild(s);
    }
    const rock = new TilingSprite({ texture: rockTexture(), width: right - left, height: bottom });
    rock.position.set(left, 0);
    const dirt = new TilingSprite({ texture: dirtTexture(), width: right - left, height: 20 });
    dirt.position.set(left, 0);
    const grass = new TilingSprite({ texture: grassTexture(), width: right - left, height: 8 });
    grass.position.set(left, -6);
    const shade = new Graphics();
    for (let i = 0; i < 14; i++) shade.rect(left, 20 + i * 140, right - left, 140).fill({ color: 0x000000, alpha: Math.min(0.55, i * 0.045) });
    shade.rect(left, 20 + 14 * 140, right - left, bottom).fill({ color: 0x000000, alpha: 0.6 });
    this.ground.addChild(rock, dirt, shade, grass);
    const hut = new Sprite(hutTexture());
    const hx = SHAFT_X + Math.round(SHAFT_W / 2) - 48;
    hut.position.set(hx, -64);
    this.ground.addChild(hut);
    const sign = new Text({ text: 'CLAWD BASE', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 7, fontWeight: '700', fill: 0xff9f7a, letterSpacing: 1 } });
    sign.anchor.set(0.5, 0.5);
    sign.resolution = 8;
    sign.position.set(hx + 48, -64 + 24.5);
    this.ground.addChild(sign);
    const antenna = new Graphics();
    antenna.rect(hx + 78, -96, 2, 34).fill(0x6f6a7d);
    antenna.rect(hx + 72, -88, 14, 2).fill(0x6f6a7d);
    antenna.rect(hx + 74, -80, 10, 2).fill(0x6f6a7d);
    this.ground.addChild(antenna);
    this.antennaLight.position.set(hx + 77, -100);
  }

  /** Concrete hulls, slabs with cable ducts, the elevator shaft and ladders. */
  private buildStructure(layout: SceneLayout): void {
    const g = this.structure;
    g.clear();
    const bottom = levelTop(layout.levels) - SLAB;
    g.rect(SHAFT_X - 4, -8, SHAFT_W + 8, bottom + 12).fill(0x38343f);
    g.rect(SHAFT_X, -4, SHAFT_W, bottom + 4).fill(0x16131c);
    g.rect(SHAFT_X + 4, -4, 2, bottom + 4).fill(0x4a4658);
    g.rect(SHAFT_X + SHAFT_W - 6, -4, 2, bottom + 4).fill(0x4a4658);
    for (let lv = 0; lv < layout.levels; lv++) {
      const y = levelTop(lv);
      g.rect(SHAFT_X, y + ROOM_H - 2, SHAFT_W, 4).fill(0x4a4552);
      g.rect(SHAFT_X + 10, y + 10, 6, 4).fill(0x1f3a2a);
      g.rect(SHAFT_X + 11, y + 11, 4, 2).fill(0x7ee08f);
    }
    for (const r of layout.rooms) g.rect(r.x - 6, r.y - 6, r.w + 12, ROOM_H + SLAB + 6).fill(0x38343f);
    for (const r of layout.rooms) {
      g.rect(r.x - 6, r.y + ROOM_H, r.w + 12, SLAB).fill(0x4a4552);
      g.rect(r.x - 6, r.y + ROOM_H + 7, r.w + 12, 2).fill(0x2b2833);
      for (let x = r.x + 8; x < r.x + r.w; x += 24) g.rect(x, r.y + ROOM_H + 3, 2, 2).fill(0x5a5462);
    }
    // corridors from the shaft to each level's first room
    for (let lv = 0; lv < layout.levels; lv++) {
      const y = levelTop(lv);
      if (layout.rooms.some((r) => r.level === lv && r.x === ROOM_X0)) {
        g.rect(SHAFT_X + SHAFT_W - 2, y + 62, ROOM_X0 - SHAFT_X - SHAFT_W + 4, ROOM_H - 62).fill(0x2a2633);
        g.rect(SHAFT_X + SHAFT_W - 2, y + ROOM_H - 2, ROOM_X0 - SHAFT_X - SHAFT_W + 4, 2).fill(0x5a5462);
      }
    }
    for (const l of layout.ladders) {
      g.rect(l.x, l.y - 6, l.w, l.h + 12).fill(0x221d2a);
      const lx = l.x + Math.round(l.w / 2) - 6;
      g.rect(lx, l.y - 6, 2, l.h + 12).fill(0x6f6a7d);
      g.rect(lx + 10, l.y - 6, 2, l.h + 12).fill(0x6f6a7d);
      for (let y = l.y; y < l.y + l.h; y += 8) g.rect(lx, y, 12, 2).fill(0x5a5468);
    }
  }

  // ───────────── camera & input ─────────────

  private bindInput(): void {
    const canvas = this.app.canvas;
    // Trackpads send dozens of small wheel events per gesture: accumulate them and take at most
    // one zoom step per 140 ms (a mouse notch, ~100 px, still zooms at once).
    let wheelAcc = 0;
    let lastWheel = 0;
    let lastStep = 0;
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - lastWheel > 300) wheelAcc = 0;
        lastWheel = now;
        wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (Math.abs(wheelAcc) < 50 || now - lastStep < 140) return;
        const rect = canvas.getBoundingClientRect();
        this.zoomAt(wheelAcc < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
        wheelAcc = 0;
        lastStep = now;
      },
      { passive: false },
    );
    this.app.stage.on('pointerdown', (e) => {
      this.dragging = { x: e.global.x, y: e.global.y, camX: this.camX, camY: this.camY, moved: false };
    });
    this.app.stage.on('globalpointermove', (e) => {
      const d = this.dragging;
      if (!d) return;
      const dx = e.global.x - d.x;
      const dy = e.global.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        // Grab the camera where it is, even mid-flight.
        this.userCamera();
        d.camX = this.camX;
        d.camY = this.camY;
        d.x = e.global.x;
        d.y = e.global.y;
      }
      if (d.moved) {
        this.camX = d.camX - (e.global.x - d.x) / this.zoom;
        this.camY = d.camY - (e.global.y - d.y) / this.zoom;
        this.applyCamera();
      }
    });
    const end = () => {
      this.suppressTap = !!this.dragging?.moved;
      this.dragging = null;
      setTimeout(() => (this.suppressTap = false), 0);
    };
    this.app.stage.on('pointerup', end);
    this.app.stage.on('pointerupoutside', end);
  }

  zoomAt(dir: number, sx?: number, sy?: number): void {
    if (!this.ready) return;
    sx ??= this.app.screen.width / 2;
    sy ??= this.app.screen.height / 2;
    const base = this.zoomT ?? this.zoom;
    const next = Math.max(1, Math.min(6, Math.round(base * 2) / 2 + dir));
    this.userCamera();
    if (next === this.zoom) return;
    const wx = this.camX + (sx - this.app.screen.width / 2) / this.zoom;
    const wy = this.camY + (sy - this.app.screen.height / 2) / this.zoom;
    this.zoom = next;
    this.camX = wx - (sx - this.app.screen.width / 2) / this.zoom;
    this.camY = wy - (sy - this.app.screen.height / 2) / this.zoom;
    this.applyCamera();
  }

  /** Glide the camera to a world point and zoom (spring, retargetable while moving). */
  private animateTo(x: number, y: number, zoom = this.zoomT ?? this.zoom): void {
    this.camTX = x;
    this.camTY = y;
    this.zoomT = zoom;
  }

  /** Move the camera to a world point (smoothly unless `immediate`). */
  panTo(x: number, y: number, immediate = false): void {
    if (immediate) {
      this.camTX = this.camTY = this.zoomT = null;
      this.velX = this.velY = this.velZ = 0;
      this.camX = x;
      this.camY = y;
      this.applyCamera();
    } else this.animateTo(x, y);
  }

  /** Fit the whole base (the "Recentrer" button, and the first view of a session). */
  recenter(immediate = false): void {
    if (!this.ready) return;
    const l = this.layout;
    if (!l) return;
    if (!immediate) this.userCamera();
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const fit = Math.floor(Math.min(sw / (l.bounds.w + 48), sh / (l.bounds.h + 48)));
    let zoom: number;
    let x: number;
    let y: number;
    if (fit >= 2) {
      zoom = Math.min(fit, 3);
      x = l.bounds.x + l.bounds.w / 2;
      y = l.bounds.y + l.bounds.h / 2;
    } else {
      zoom = sw > 1500 ? 2 : 1;
      x = l.bounds.x + Math.min(l.bounds.w, sw / zoom) / 2 - 8;
      y = l.bounds.y + sh / zoom / 2 - 8;
    }
    if (immediate) {
      this.zoom = zoom;
      this.panTo(x, y, true);
    } else this.animateTo(x, y, zoom);
  }

  focusRoom(key: string): void {
    if (!this.ready) return;
    const r = this.rooms.get(key);
    if (!r) return;
    const b = r.bounds;
    const v = this.viewRect();
    if (b.x < v.x || b.y < v.y || b.x + b.w > v.x + v.w || b.y + b.h > v.y + v.h) {
      this.userCamera();
      this.animateTo(b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  /** Minimap click: centre on a world point. */
  centerOn(x: number, y: number): void {
    this.userCamera();
    this.animateTo(x, y);
  }

  private viewRect(): { x: number; y: number; w: number; h: number } {
    const w = this.app.screen.width / this.zoom;
    const h = this.app.screen.height / this.zoom;
    return { x: this.camX - w / 2, y: this.camY - h / 2, w, h };
  }

  /** Advance the camera spring by `dt` seconds. */
  private stepCamera(dt: number): void {
    if (this.camTX === null || this.camTY === null) return;
    const zt = this.zoomT ?? this.zoom;
    [this.camX, this.velX] = smoothDamp(this.camX, this.camTX, this.velX, 0.33, dt);
    [this.camY, this.velY] = smoothDamp(this.camY, this.camTY, this.velY, 0.33, dt);
    [this.zoom, this.velZ] = smoothDamp(this.zoom, zt, this.velZ, 0.3, dt);
    const rest = Math.abs(this.camTX - this.camX) < 0.3 && Math.abs(this.camTY - this.camY) < 0.3 && Math.abs(zt - this.zoom) < 0.003 && Math.abs(this.velX) + Math.abs(this.velY) < 6;
    if (rest) {
      this.camX = this.camTX;
      this.camY = this.camTY;
      this.zoom = zt;
      this.camTX = this.camTY = this.zoomT = null;
      this.velX = this.velY = this.velZ = 0;
    }
    this.applyCamera();
  }

  private applyCamera(): void {
    if (!this.ready || this.destroyed) return;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const ox = Math.round(sw / 2 - this.camX * this.zoom);
    const oy = Math.round(sh / 2 - this.camY * this.zoom);
    this.world.scale.set(this.zoom);
    this.world.position.set(ox, oy);
    this.stars.position.set(Math.round((-this.camX * 0.05) % 2400), Math.round(Math.min(0, -this.camY * 0.05)));
    // Texts are re-rasterised when their resolution changes: during a zoom, keep the sharper of
    // both ends so this happens at most once at the start (zoom in) or once at the end (zoom out).
    const moving = this.zoomT !== null;
    this.textZoom = moving ? Math.max(this.zoomT ?? this.zoom, this.textZoom) : this.zoom;
    const res = this.textZoom * (window.devicePixelRatio || 1);
    const detail = this.zoom < 1.25 ? 'low' : 'full';
    for (const r of this.rooms.values()) {
      r.setTextResolution(res);
      r.setDetail(detail);
    }
    // React overlays (focus buttons, minimap) do not need 60 updates per second while gliding.
    const now = performance.now();
    if (!moving || now - this.lastCamEmit > 120) {
      this.lastCamEmit = now;
      this.emitFocusRects();
      this.emitMinimap(true);
    }
  }

  private emitFocusRects(): void {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const ox = Math.round(sw / 2 - this.camX * this.zoom);
    const oy = Math.round(sh / 2 - this.camY * this.zoom);
    const rects: FocusRect[] = [];
    for (const slot of this.layout?.rooms ?? []) {
      if (slot.entity === 'filler') continue;
      let label: string = t.agent;
      if (slot.entity === 'workflow') label = t.workflowName(data.workflows.get(slot.id)?.name ?? '');
      else {
        const ag = data.agents.get(slot.id);
        if (ag) label = ag.kind === 'main' ? t.mainRoom : agentLabel(ag);
      }
      rects.push({ key: slot.key, entity: slot.entity, id: slot.id, label, x: ox + slot.x * this.zoom, y: oy + slot.y * this.zoom, w: slot.w * this.zoom, h: slot.h * this.zoom });
    }
    this.onFocusRects(rects);
  }

  private emitMinimap(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastMinimap < 300) return;
    this.lastMinimap = now;
    const l = this.layout;
    if (!l) return;
    const rooms = l.rooms.map((r) => {
      let color = '#2e2838';
      if (r.entity === 'workflow') color = '#f2c14e';
      else if (r.entity === 'agent') {
        const a = data.agents.get(r.id);
        color = a ? (a.waiting ? '#f2c14e' : (STATUS_COLOR[a.status] ?? '#b9a8d6')) : '#b9a8d6';
        if (a?.kind === 'main') color = '#d77757';
      }
      return { x: r.x, y: r.y, w: r.w, h: r.h, color };
    });
    this.onMinimap({ bounds: l.bounds, rooms, view: this.viewRect() });
  }

  // ───────────── data sync ─────────────

  requestSync(): void {
    if (this.syncQueued) return;
    const wait = Math.max(0, 100 - (performance.now() - this.lastSync));
    this.syncQueued = true;
    setTimeout(() => {
      this.syncQueued = false;
      if (!this.destroyed && this.ready) this.sync();
    }, wait);
  }

  private sync(): void {
    this.lastSync = performance.now();
    const { sessionId, selection, config } = useDash.getState();
    const now = Date.now();
    if (!sessionId) {
      for (const r of this.rooms.values()) r.markRemoving(performance.now());
      this.layout = null;
      return;
    }
    const showArchived = useDash.getState().showArchived;
    const allAgents = sessionAgents(sessionId);
    // Finished agents leave the base after a while (still in timeline/files/list).
    const agents = showArchived ? allAgents : allAgents.filter((a) => !isArchived(a, now));
    const visibleIds = new Set(agents.map((a) => a.id));
    const allWorkflows = sessionWorkflows(sessionId);
    const workflows = allWorkflows
      .map((w) => ({ ...w, steps: w.steps.map((st) => ({ ...st, agentIds: st.agentIds.filter((id) => visibleIds.has(id)) })).filter((st) => st.agentIds.length > 0) }))
      .filter((w) => w.steps.length > 0);
    const compact = this.compactForced || agents.length - 1 > 14;
    const main = agents.find((a) => a.kind === 'main');
    // Independent of the zoom (zooming must never reshuffle the rooms); the main room and three
    // agents, the most common case, share one row.
    const maxRowWidth = Math.max(1320, Math.floor(this.app.screen.width / 2) - 40);
    const layout = computeLayout(main, agents, workflows, { compact, maxRowWidth });
    const firstLayoutForSession = this.centeredFor !== sessionId;
    const sig = `${layout.rooms.map((r) => `${r.key}@${r.x},${r.y},${r.w}`).join('|')}#${layout.levels}`;
    if (sig !== this.layoutSig) {
      this.layoutSig = sig;
      this.buildStructure(layout);
      const gsig = `${layout.width}:${layout.levels}`;
      if (gsig !== this.groundSig) {
        this.groundSig = gsig;
        this.buildGround(layout);
      }
    }
    this.layout = layout;

    const seen = new Set<string>();
    const detail = this.zoom < 1.25 ? 'low' : 'full';
    let mostRecent: { key: string; at: number; level: number } | null = null;
    for (const slot of layout.rooms) {
      seen.add(slot.key);
      let room = this.rooms.get(slot.key);
      room?.revive();
      const isNew = !room;
      if (!room) {
        room = new RoomView(
          slot.key,
          slot.entity === 'filler'
            ? null
            : () => {
                if (this.suppressTap) return;
                const cur = this.layout?.rooms.find((s) => s.key === slot.key);
                if (cur && cur.entity !== 'filler') useDash.getState().select({ kind: cur.entity, id: cur.id });
              },
        );
        room.setTextResolution(this.textZoom * (window.devicePixelRatio || 1));
        room.setDetail(detail);
        this.rooms.set(slot.key, room);
        this.roomsLayer.addChild(room);
      }
      let info: RoomInfo | null;
      if (slot.entity === 'workflow') info = this.workflowInfo(data.workflows.get(slot.id), slot.w, selection?.kind === 'workflow' && selection.id === slot.id, config.spriteSet);
      else if (slot.entity === 'filler') info = this.fillerInfo(slot.kind, slot.key, slot.w);
      else {
        const a = data.agents.get(slot.id);
        info = this.agentInfo(a, slot.kind, slot.w, selection?.kind === 'agent' && selection.id === slot.id, now, config.spriteSet);
        if (a && isActive(a) && (!mostRecent || a.lastActivityAt > mostRecent.at)) mostRecent = { key: slot.key, at: a.lastActivityAt, level: slot.level };
      }
      if (info) room.update(info);
      room.setTarget(slot.x, slot.y, isNew);
    }
    const nowP = performance.now();
    for (const [key, room] of this.rooms) if (!seen.has(key)) room.markRemoving(nowP);

    this.trackTransitions(sessionId, allWorkflows);
    if (firstLayoutForSession) {
      this.centeredFor = sessionId;
      this.recenter(true);
    }
    this.updateTracking(layout, sessionId);

    // The elevator goes to the level with the most recent activity.
    this.cabTargetY = levelTop(mostRecent?.level ?? 0) + ROOM_H - 46;
    if (firstLayoutForSession) this.cabY = this.cabTargetY;
    if (this.follow && !this.track && mostRecent && mostRecent.key !== this.activeRoomKey) {
      const target = mostRecent.key;
      const r = layout.rooms.find((x) => x.key === target);
      if (r) this.panTo(r.x + r.w / 2, r.y + r.h / 2);
    }
    this.activeRoomKey = mostRecent?.key ?? null;

    this.wireState.clear();
    for (const wf of workflows) {
      const active = activeStepIndex(wf);
      wf.steps.forEach((st, i) => {
        const allDone = st.agentIds.every((id) => {
          const a = data.agents.get(id);
          return a && (a.status === 'done' || a.status === 'error');
        });
        this.wireState.set(`${wf.id}:${st.index}`, i === active ? 'active' : allDone ? 'done' : 'pending');
      });
    }

    this.emitFocusRects();
    this.emitMinimap();
  }

  /** One-shot celebrations: session end fireworks, workflow done confetti, packets on new agents. */
  private trackTransitions(sessionId: string, workflows: Workflow[]): void {
    const first = this.seenSession !== sessionId;
    this.seenSession = sessionId;
    const s = data.sessions.get(sessionId);
    const ended = s?.status === 'ended';
    if (!first && ended && !this.wasEnded.get(sessionId)) {
      this.fireworksUntil = performance.now() + 7000;
      this.rooms.get(`main:${sessionId}`)?.celebrate(true);
    }
    this.wasEnded.set(sessionId, ended);
    for (const wf of workflows) {
      const agents = wf.steps.flatMap((st) => st.agentIds.map((id) => data.agents.get(id))).filter((a): a is Agent => !!a);
      const done = agents.length > 0 && agents.every((a) => a.status === 'done' || a.status === 'error');
      if (!first && done && this.wasWfDone.get(wf.id) === false) {
        this.rooms.get(`wf:${wf.id}`)?.celebrate(true);
        this.wireFlashUntil.set(wf.id, performance.now() + 1600);
      }
      this.wasWfDone.set(wf.id, done);
      for (const st of wf.steps) {
        const key = `${wf.id}:${st.index}`;
        const known = this.stepAgents.get(key);
        const fresh = known ? st.agentIds.filter((id) => !known.has(id)) : [];
        if (!first && (fresh.length > 0 || !known)) {
          const now = performance.now();
          for (let i = 0; i < 3; i++) this.packets.push({ wire: `feed:${wf.id}:${st.index}`, start: now + i * 180 });
        }
        this.stepAgents.set(key, new Set(st.agentIds));
      }
    }
    if (this.packets.length > 60) this.packets.splice(0, this.packets.length - 60);
  }

  private agentInfo(a: Agent | undefined, kind: RoomInfo['kind'], width: number, selected: boolean, now: number, spriteSet: string): RoomInfo | null {
    if (!a) return null;
    const session = data.sessions.get(a.sessionId);
    const anim = animationFor(a, now, a.endedAt);
    const { station, prop } = activityOf(a, anim);
    const files = Object.values(a.files).sort((x, y) => y.lastAt - x.lastAt);
    const board: BoardLine[] = [];
    const main = a.kind === 'main';
    const maxLines = 5;
    const subsRunning = main ? [...data.agents.values()].filter((x) => x.sessionId === a.sessionId && x.kind === 'sub' && isActive(x)).length : 0;
    if (a.waiting) board.push({ text: `? ${a.waiting}`, color: C.warn });
    else if (a.currentTool) board.push({ text: `> ${toolDisplayName(a.currentTool)} ${a.currentToolInputPreview ?? ''}`, color: C.tool });
    else if (isActive(a)) board.push({ text: `… ${t.thinking}`, color: C.muted });
    else board.push({ text: subsRunning ? t.agentsRunning(subsRunning) : t.statusLabel[a.status], color: subsRunning ? C.tool : C.muted });
    const doing = a.todos.find((x) => x.status === 'in_progress');
    if (doing) {
      const done = a.todos.filter((x) => x.status === 'completed').length;
      board.push({ text: `☐ ${done}/${a.todos.length} ${doing.activeForm ?? doing.content}`, color: C.todo });
    }
    for (const f of files.slice(0, 2)) {
      const live = now - f.lastAt < 30_000;
      board.push({
        text: `${f.lastOp === 'read' ? 'R' : 'W'} ${basename(f.path)}${f.edits ? ` +${f.added}/-${f.removed}` : ''}${live ? ' •' : ''}`,
        color: f.lastOp === 'read' ? C.read : C.edit,
      });
    }
    const promptText = main ? (session?.lastPrompt ?? '') : a.prompt;
    if (promptText) {
      for (const line of wrap(preview(promptText, 100), main ? 33 : 27)) {
        if (board.length >= maxLines) break;
        board.push({ text: line, color: C.prompt });
      }
    }
    const u = a.usage;
    const title = main ? (session?.title ?? t.mainRoom) : agentLabel(a);
    const window = session?.contextWindow ?? 200_000;
    const ctx = a.contextTokens ? ` · ctx ${Math.round((a.contextTokens / window) * 100)}%` : '';
    const subtitle = `${modelBadge(a.model)} · ${a.waiting ? t.waitingShort : t.statusLabel[a.status]}${main ? (session ? ` · ${formatDuration((session.endedAt ?? now) - session.startedAt)}` : '') : ` · ${a.type}`}${ctx}`;
    const footer =
      kind === 'compact'
        ? `${t.statusLabel[a.status]}\nΣ${formatTokens(u.total)}\n+${a.added} -${a.removed}`
        : `↓${formatTokens(u.input)} ↑${formatTokens(u.output)} ⛁${formatTokens(u.cacheCreate + u.cacheRead)} Σ${formatTokens(u.total)}   +${a.added} -${a.removed}`;
    const live = a.liveText && (!a.liveTextFinal || now - a.liveTextAt < 6000) ? a.liveText : null;
    return {
      kind,
      width,
      seed: mascotSeed(a),
      filler: false,
      chief: false,
      canonical: main,
      title,
      subtitle,
      bigLabel: title.slice(0, 22),
      statusColor: STATUS_COLOR[a.status] ?? '#b9a8d6',
      lampOn: a.status !== 'idle' || !main,
      anim,
      station,
      prop,
      board,
      footer,
      added: a.added,
      removed: a.removed,
      errorCount: a.errorCount,
      dim: a.kind === 'sub' && a.status === 'done',
      selected,
      spriteSet,
      waiting: !!a.waiting,
      status: a.status,
      compactions: a.compactions,
      tokens: a.usage.total,
      toolCount: a.toolCount,
      toolLabel: a.currentTool ? toolDisplayName(a.currentTool) : null,
      liveText: live,
      screenActive: isActive(a),
      steps: null,
    };
  }

  private workflowInfo(w: Workflow | undefined, width: number, selected: boolean, spriteSet: string): RoomInfo | null {
    if (!w) return null;
    const agents = w.steps.flatMap((s) => s.agentIds.map((id) => data.agents.get(id))).filter((a): a is Agent => !!a);
    const active = activeStepIndex(w);
    const done = agents.length > 0 && agents.every((a) => a.status === 'done' || a.status === 'error');
    const errors = agents.reduce((s, a) => s + a.errorCount, 0);
    const u = agents.reduce((acc, a) => ({ i: acc.i + a.usage.input, o: acc.o + a.usage.output, c: acc.c + a.usage.cacheCreate + a.usage.cacheRead, t: acc.t + a.usage.total }), { i: 0, o: 0, c: 0, t: 0 });
    const added = agents.reduce((s, a) => s + a.added, 0);
    const removed = agents.reduce((s, a) => s + a.removed, 0);
    const steps: StepBox[] = w.steps.map((st, i) => {
      const as = st.agentIds.map((id) => data.agents.get(id)).filter((a): a is Agent => !!a);
      const finished = as.length > 0 && as.every((a) => a.status === 'done' || a.status === 'error');
      const state: StepBox['state'] = i === active ? 'active' : finished ? (as.some((a) => a.status === 'error') ? 'error' : 'done') : 'pending';
      return { state, count: st.agentIds.length };
    });
    const label = t.workflowName(w.name);
    const board: BoardLine[] = [
      {
        text: active >= 0 ? `${t.step} ${w.steps[active]?.index}/${w.steps.length} — ${t.statusLabel.running}` : done ? `${t.statusLabel.done} (${w.steps.length} ${t.steps.toLowerCase()})` : t.statusLabel.idle,
        color: active >= 0 ? C.tool : C.muted,
      },
      { text: `${agents.filter(isActive).length}/${agents.length} ${t.activeAgents}${errors ? ` · ${errors} ✖` : ''}`, color: C.text },
      { text: t.source[w.source], color: C.muted },
    ];
    return {
      kind: 'chief',
      width,
      seed: w.id,
      filler: false,
      chief: true,
      canonical: false,
      title: `♛ ${label}`,
      subtitle: `${w.steps.length} ${t.steps.toLowerCase()} · ${agents.length} ${t.agents.toLowerCase()}`,
      bigLabel: `♛ ${label}`.slice(0, 22),
      statusColor: active >= 0 ? (STATUS_COLOR['running'] as string) : done ? (STATUS_COLOR['done'] as string) : (STATUS_COLOR['idle'] as string),
      lampOn: true,
      anim: active >= 0 ? 'think' : done ? 'celebrate' : 'idle',
      station: 'desk',
      prop: active >= 0 ? 'bubble' : 'none',
      board,
      footer: `↓${formatTokens(u.i)} ↑${formatTokens(u.o)} ⛁${formatTokens(u.c)} Σ${formatTokens(u.t)}   +${added} -${removed}`,
      added,
      removed,
      errorCount: errors,
      status: done ? 'done' : active >= 0 ? 'running' : 'idle',
      compactions: 0,
      tokens: u.t,
      toolCount: 0,
      toolLabel: null,
      dim: false,
      selected,
      spriteSet,
      waiting: false,
      liveText: null,
      screenActive: false,
      steps,
    };
  }

  private fillerInfo(kind: RoomInfo['kind'], key: string, width: number): RoomInfo {
    const name = t.filler[kind.replace('filler-', '') as FillerKind] ?? '';
    return {
      kind,
      width,
      seed: key,
      filler: true,
      chief: false,
      canonical: false,
      title: name,
      subtitle: '',
      bigLabel: '',
      statusColor: '#3a3248',
      lampOn: false,
      anim: 'idle',
      station: 'desk',
      prop: 'none',
      board: [],
      footer: '',
      added: 0,
      removed: 0,
      errorCount: 0,
      status: 'idle',
      compactions: 0,
      tokens: 0,
      toolCount: 0,
      toolLabel: null,
      dim: false,
      selected: false,
      spriteSet: 'mole',
      waiting: false,
      liveText: null,
      screenActive: false,
      steps: null,
    };
  }

  // ───────────── frame loop ─────────────

  private tick(): void {
    const now = performance.now();
    const animFrame = Math.floor(now / 420);
    const fastFrame = Math.floor(now / 170);
    this.stepCamera(Math.min(0.05, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    const v = this.viewRect();
    const margin = 64;
    for (const [key, room] of this.rooms) {
      const b = room.bounds;
      const visible = b.x + b.w > v.x - margin && b.x < v.x + v.w + margin && b.y + b.h > v.y - margin && b.y < v.y + v.h + margin;
      room.visible = visible || room.removing;
      if (!room.tick(now, animFrame, fastFrame, visible)) {
        const seed = room.seed;
        room.destroy({ children: true });
        this.rooms.delete(key);
        // Free this room's textures unless another live room uses the same seed.
        if (seed && ![...this.rooms.values()].some((r) => r.seed === seed)) releaseSeed(seed);
      }
    }
    this.drawCables(now);
    const cabGap = Math.abs(this.cabTargetY - this.cabY);
    if (cabGap > 2) this.cabMoving = true;
    else if (this.cabMoving && cabGap < 1) {
      // "ding": the cab arrived at its level
      this.cabMoving = false;
      this.landingUntil = now + 600;
      this.fx.sparks(SHAFT_X + SHAFT_W / 2, this.cabTargetY + 4, 6);
    }
    this.cabY += (this.cabTargetY - this.cabY) * 0.06;
    this.cab.position.set(SHAFT_X + 4, Math.round(this.cabY));
    this.landingLight.clear();
    if (now < this.landingUntil) this.landingLight.rect(SHAFT_X + SHAFT_W - 8, this.cabTargetY + 2, 4, 4).fill(Math.floor(now / 100) % 2 ? 0xffe7a3 : 0x7ee08f);
    this.tickAmbience(now);
    this.fx.update(now, Math.min(0.1, (now - (this.lastFxTick || now)) / 1000));
    this.lastFxTick = now;
    this.antennaLight.clear();
    const blink = now < this.antennaUntil || Math.floor(now / 900) % 4 === 0;
    this.antennaLight.rect(0, 0, 4, 4).fill(blink ? 0xff6b6b : 0x5a2a2a);
    if (blink) this.antennaLight.rect(-2, -2, 8, 8).fill({ color: 0xff6b6b, alpha: 0.25 });
    if (fastFrame % 3 === 0) for (const s of this.stars.children as Star[]) s.alpha = 0.45 + 0.4 * Math.sin(now / 900 + s.phase);
    if (animFrame % 140 === 0) this.drawSky();
    // Celebrate → sleep and live-text expiry are time based.
    if (now - this.lastSync > 1000) this.requestSync();
    this.emitMinimap();
    const f = this.fpsAcc;
    f.frames++;
    if (now - f.since > 1000) {
      f.fps = Math.round((f.frames * 1000) / (now - f.since));
      f.frames = 0;
      f.since = now;
      this.onFps(f.fps);
    }
  }

  private lastFxTick = 0;

  /** Night ambience (fireflies, shooting stars) and fireworks when a session ends. */
  private tickAmbience(now: number): void {
    const hour = new Date().getHours();
    const night = hour >= 20 || hour < 7;
    const v = this.viewRect();
    this.fireflies.visible = night;
    if (night) {
      for (const f of this.fireflies.children as Star[]) {
        const t = now / 1000 + f.phase;
        const span = Math.max(200, v.w);
        f.position.set(Math.round(v.x + ((f.phase * 37) % span) + Math.sin(t * 0.7) * 24), Math.round(-14 + Math.sin(t * 1.3) * 8));
        f.alpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 2.1));
      }
    }
    // shooting star (screen space)
    this.meteor.clear();
    if (night && !this.meteorState && now > this.nextMeteor) {
      this.meteorState = { x: Math.random() * this.app.screen.width * 0.8, y: 20 + Math.random() * 80, vx: 420, vy: 140, start: now };
      this.nextMeteor = now + 14_000 + Math.random() * 16_000;
    }
    if (this.meteorState) {
      const m = this.meteorState;
      const k = (now - m.start) / 700;
      if (k >= 1) this.meteorState = null;
      else {
        const x = m.x + m.vx * k;
        const y = m.y + m.vy * k;
        for (let i = 0; i < 10; i++) this.meteor.rect(Math.round(x - i * 4), Math.round(y - i * 1.4), 2, 1).fill({ color: 0xffffff, alpha: (1 - i / 10) * (1 - k) });
      }
    }
    // fireworks above the surface
    if (now < this.fireworksUntil && now > this.nextRocket) {
      this.nextRocket = now + 260 + Math.random() * 300;
      const x = Math.max(v.x + 40, Math.min(v.x + v.w - 40, SHAFT_X + 40 + (Math.random() - 0.3) * Math.min(900, v.w)));
      const colors = [0xff8a8a, 0xf2c14e, 0x7ee08f, 0x6cc4ff, 0xc58cff, 0xffffff];
      const color = colors[Math.floor(Math.random() * colors.length)] as number;
      this.fx.pixel(x, -4, 0xffe7a3, {
        vx: (Math.random() - 0.5) * 30,
        vy: -150 - Math.random() * 60,
        ay: 70,
        size: 2,
        life: 900 + Math.random() * 300,
        onDeath: (bx, by) => {
          for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            const sp = 40 + Math.random() * 30;
            this.fx.pixel(bx, by, i % 3 === 0 ? 0xffffff : color, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 40, size: 2, life: 900 + Math.random() * 500, drag: 0.8 });
          }
        },
      });
    }
  }

  private drawCables(now: number): void {
    const g = this.cablesG;
    g.clear();
    for (const w of this.layout?.wires ?? []) this.drawWire(g, w, this.wireState.get(`${w.workflowId}:${w.stepIndex}`) ?? 'pending', now);
    // data packets sent to a step when one of its agents is launched (drawn above the cables)
    for (const w of this.layout?.wires ?? []) {
      if (w.type !== 'feed') continue;
      let total = 0;
      for (let i = 1; i < w.points.length; i++) total += Math.hypot((w.points[i]?.x ?? 0) - (w.points[i - 1]?.x ?? 0), (w.points[i]?.y ?? 0) - (w.points[i - 1]?.y ?? 0));
      for (const pk of this.packets) {
        if (pk.wire !== w.key || now < pk.start) continue;
        const d = (now - pk.start) * 0.22;
        if (d > total) continue;
        const p = this.pointAt(w.points, d);
        if (p) g.rect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6).fill(0xffe7a3).rect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2).fill(0xffffff);
      }
    }
    for (const l of this.layout?.links ?? []) {
      this.polyline(g, l.points);
      g.stroke({ width: 2, color: 0x0b090e, alpha: 0.8 });
      this.dashed(g, l.points, 2, 3, (now * 0.01) % 5);
      g.stroke({ width: 1, color: 0xc58cff, alpha: 0.9 });
    }
  }

  private drawWire(g: Graphics, w: Wire, state: 'pending' | 'active' | 'done', now: number): void {
    const flashing = now < (this.wireFlashUntil.get(w.workflowId) ?? 0);
    const color = flashing ? (Math.floor(now / 120) % 2 ? 0xffffff : 0x7ee08f) : state === 'active' ? 0x6cc4ff : state === 'done' ? 0x7ee08f : 0x5a4d70;
    if (state === 'active' || flashing) {
      this.polyline(g, w.points);
      g.stroke({ width: 7, color, alpha: 0.16 + 0.1 * Math.sin(now / 200) });
    }
    this.polyline(g, w.points);
    g.stroke({ width: 3, color: 0x0b090e, alpha: 0.95 });
    const dash = w.type === 'path' ? 4 : 6;
    const gap = w.type === 'path' ? 3 : 5;
    const speed = state === 'active' ? 0.045 : state === 'done' ? 0.008 : 0;
    this.dashed(g, w.points, dash, gap, (now * speed) % (dash + gap));
    g.stroke({ width: state === 'active' ? 2 : 1, color, alpha: state === 'pending' ? 0.75 : 1 });
    if (state === 'active') {
      // a bright pulse travelling down the cable
      let total = 0;
      for (let i = 1; i < w.points.length; i++) total += Math.hypot((w.points[i]?.x ?? 0) - (w.points[i - 1]?.x ?? 0), (w.points[i]?.y ?? 0) - (w.points[i - 1]?.y ?? 0));
      const p = this.pointAt(w.points, ((now * 0.09) % (total + 40)) - 20);
      if (p) g.rect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4).fill(0xe8f6ff);
    }
  }

  private pointAt(pts: Array<{ x: number; y: number }>, dist: number): { x: number; y: number } | null {
    if (dist < 0) return null;
    let d = dist;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[i + 1] as { x: number; y: number };
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= len) return { x: a.x + ((b.x - a.x) * d) / (len || 1), y: a.y + ((b.y - a.y) * d) / (len || 1) };
      d -= len;
    }
    return null;
  }

  private polyline(g: Graphics, pts: Array<{ x: number; y: number }>): void {
    const [p0, ...rest] = pts;
    if (!p0) return;
    g.moveTo(p0.x, p0.y);
    for (const p of rest) g.lineTo(p.x, p.y);
  }

  private dashed(g: Graphics, pts: Array<{ x: number; y: number }>, dash: number, gap: number, offset: number): void {
    let carry = -offset;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[i + 1] as { x: number; y: number };
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      let d = carry;
      while (d < len) {
        const s = Math.max(0, d);
        const e = Math.min(len, d + dash);
        if (e > s) {
          g.moveTo(a.x + ux * s, a.y + uy * s);
          g.lineTo(a.x + ux * e, a.y + uy * e);
        }
        d += dash + gap;
      }
      // Continue the dash pattern on the next segment.
      carry = d - len;
    }
  }
}
