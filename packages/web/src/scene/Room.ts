import { Container, Graphics, Rectangle, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import type { Anim } from '@dash/shared';
import { roomGeometry, type RoomGeometry, type RoomKind, type Stations } from './tiles.ts';
import { lampTexture, mascotTexture, propTexture, releaseRoomTexture, roomTexture, sparkleTexture, zzzTexture, type PropKind } from './textures.ts';
import { ParticleSystem } from './particles.ts';

export interface BoardLine {
  text: string;
  color: number;
}

export interface StepBox {
  state: 'pending' | 'active' | 'done' | 'error';
  count: number;
}

/** Everything a room needs to render; computed by the scene from live data. */
export interface RoomInfo {
  kind: RoomKind;
  width: number;
  seed: string;
  filler: boolean;
  chief: boolean;
  canonical: boolean;
  title: string;
  subtitle: string;
  /** Large label used at low zoom. */
  bigLabel: string;
  status: string;
  statusColor: string;
  lampOn: boolean;
  anim: Anim;
  station: keyof Stations;
  prop: PropKind | 'none';
  board: BoardLine[];
  footer: string;
  added: number;
  removed: number;
  errorCount: number;
  compactions: number;
  tokens: number;
  toolCount: number;
  toolLabel: string | null;
  /** Lights off (finished agents). */
  dim: boolean;
  selected: boolean;
  spriteSet: string;
  waiting: boolean;
  liveText: string | null;
  screenActive: boolean;
  steps: StepBox[] | null;
}

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CHAR_W = 0.6;
const WALK_SPEED = 46; // world px per second at scale 2
const BUILD_MS = 1100;
const LEAVE_MS = 1900;

function style(size: number, fill: number, bold = false): TextStyleOptions {
  return { fontFamily: FONT, fontSize: size, fill, fontWeight: bold ? '700' : '400', lineHeight: Math.round(size * 1.25) };
}

function clip(s: string, maxChars: number): string {
  if (maxChars <= 1) return '';
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

function formatK(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Draw a dashed polyline (closed rectangle perimeter, scaffolds, marching ants). */
function dashedPath(g: Graphics, pts: Array<[number, number]>, dash: number, gap: number, offset: number, maxLen = Infinity): void {
  let carry = -offset;
  let drawn = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i] as [number, number];
    const [x2, y2] = pts[i + 1] as [number, number];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!len) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    let d = carry;
    while (d < len) {
      const a = Math.max(0, d);
      const b = Math.min(len, d + dash, maxLen - drawn + a);
      if (b > a) g.moveTo(x1 + ux * a, y1 + uy * a).lineTo(x1 + ux * b, y1 + uy * b);
      d += dash + gap;
    }
    carry = d - len;
    drawn += len;
    if (drawn >= maxLen) break;
  }
}

const STEP_COLORS: Record<StepBox['state'], number> = { pending: 0x4b3d5e, active: 0x6cc4ff, done: 0x7ee08f, error: 0xff6b6b };

export class RoomView extends Container {
  readonly key: string;
  private kindKey = '';
  private geo!: RoomGeometry;
  /** Everything inside the room (masked during construction). */
  private readonly content = new Container();
  private readonly revealMask = new Graphics();
  private readonly scaffold = new Graphics();
  private readonly bg = new Sprite();
  private readonly screenG = new Graphics();
  private readonly stepsG = new Graphics();
  private readonly glowG = new Graphics();
  private readonly mascot = new Sprite();
  private readonly prop = new Sprite();
  private readonly lamp = new Sprite();
  private readonly title = new Text({ text: '', style: style(8, 0xf2c14e, true) });
  private readonly subtitle = new Text({ text: '', style: style(7, 0xa99fb8) });
  private readonly footer = new Text({ text: '', style: style(7, 0xece6f2) });
  private readonly bigLabel = new Text({ text: '', style: style(15, 0xf2c14e, true) });
  private readonly bigLabelBg = new Graphics();
  private readonly boardTexts: Text[] = [];
  private readonly bubble = new Container();
  private readonly bubbleBg = new Graphics();
  private readonly bubbleText = new Text({ text: '', style: style(7, 0x1a1420) });
  private bubbleTail: 'left' | 'right' | null = null;
  private readonly darkness = new Graphics();
  private readonly flash = new Graphics();
  private readonly outline = new Graphics();
  private readonly particleLayer = new Container();
  private readonly fx = new ParticleSystem(this.particleLayer);
  private info: RoomInfo | null = null;
  private targetX = 0;
  private targetY = 0;
  private readonly bornAt = performance.now();
  private flashUntil = 0;
  private shakeUntil = 0;
  private readonly last = { added: -1, removed: -1, errors: -1, compactions: -1, tokens: -1, toolCount: -1, status: '' };
  private lastZzz = 0;
  private lastTokenFx = 0;
  private textResolution = 2;
  private mascotX = 0;
  private facing = 1;
  private lastTick = performance.now();
  private darkAlpha = 0.9;
  private drawnDark = -1;
  private lastScreenFrame = -1;
  private bubbleW = 0;
  private detail: 'full' | 'low' = 'full';
  private hover = false;
  private wanderTarget: number | null = null;
  private nextWander = performance.now() + 4000;
  private built = false;
  removing = false;
  private removeAt = 0;

  constructor(key: string, onSelect: (() => void) | null) {
    super();
    this.key = key;
    if (onSelect) {
      this.eventMode = 'static';
      this.cursor = 'pointer';
      this.on('pointertap', onSelect);
      this.on('pointerover', () => this.setHover(true));
      this.on('pointerout', () => this.setHover(false));
    } else this.eventMode = 'none';
    this.mascot.anchor.set(0.5, 1);
    this.bubble.addChild(this.bubbleBg, this.bubbleText);
    this.bubble.visible = false;
    this.bigLabel.anchor.set(0.5, 0.5);
    this.content.addChild(
      this.bg,
      this.screenG,
      this.stepsG,
      this.glowG,
      this.lamp,
      this.mascot,
      this.prop,
      this.title,
      this.subtitle,
      this.footer,
      this.darkness,
      this.particleLayer,
      this.bubble,
      this.bigLabelBg,
      this.bigLabel,
      this.flash,
    );
    this.addChild(this.content, this.revealMask, this.scaffold, this.outline);
    this.content.mask = this.revealMask;
    this.alpha = 0;
  }

  setTarget(x: number, y: number, immediate: boolean): void {
    this.targetX = x;
    this.targetY = y;
    if (immediate) this.position.set(x, y);
  }

  setTextResolution(r: number): void {
    if (r === this.textResolution) return;
    this.textResolution = r;
    this.fx.textResolution = r;
    for (const t of [this.title, this.subtitle, this.footer, this.bigLabel, this.bubbleText, ...this.boardTexts]) t.resolution = r;
  }

  setDetail(d: 'full' | 'low'): void {
    if (d === this.detail) return;
    this.detail = d;
    this.applyDetail();
  }

  private setHover(h: boolean): void {
    this.hover = h;
    this.drawOutline(performance.now());
  }

  private applyDetail(): void {
    if (!this.geo) return;
    const low = this.detail === 'low';
    const big = !!this.info && this.info.bigLabel.length > 0;
    for (const t of this.boardTexts) t.visible = !low;
    this.footer.visible = !low;
    this.subtitle.visible = !low && this.geo.plaque.h > 16;
    this.title.visible = !low;
    this.bigLabel.visible = low && big;
    this.bigLabelBg.visible = low && big;
  }

  private build(info: RoomInfo): void {
    // Kind/width changed (e.g. agent → compact when done): free the previous background.
    if (this.info) releaseRoomTexture(this.info.kind, this.info.seed, roomGeometry(this.info.kind, this.info.width).w);
    this.kindKey = `${info.kind}|${info.width}`;
    this.geo = roomGeometry(info.kind, info.width);
    const g = this.geo;
    this.bg.texture = roomTexture(info.kind, info.seed, g.w);
    this.hitArea = new Rectangle(0, 0, g.w, g.h);
    this.mascot.scale.set(g.mascotScale);
    if (!this.info) this.mascotX = info.filler ? g.stations.desk : g.stations.door;
    else this.mascotX = Math.min(this.mascotX, g.w - 10);
    this.mascot.visible = !info.filler;
    this.lamp.visible = !info.filler;
    this.lamp.position.set(g.lamp.x - 4, g.lamp.y - 2);
    const big = info.kind === 'main' || info.kind === 'chief';
    const compactish = info.kind === 'compact' || info.filler;
    this.title.style = style(big ? 10 : compactish ? 7 : 8, info.filler ? 0xa99fb8 : 0xf2c14e, true);
    this.subtitle.style = style(big ? 8 : 7, 0xa99fb8);
    this.footer.style = style(compactish ? 6 : big ? 8 : 7, 0xece6f2);
    this.title.position.set(g.plaque.x + 4, g.plaque.y + 2);
    this.subtitle.position.set(g.plaque.x + 4, g.plaque.y + (big ? 14 : 13));
    this.footer.position.set(g.footer.x, g.footer.y);
    this.bigLabel.position.set(g.w / 2, 56);
    for (const t of this.boardTexts) t.destroy();
    this.boardTexts.length = 0;
    if (g.board) {
      const top = info.chief ? g.board.y + 18 : g.board.y + 3;
      const lineH = big ? 10 : 9;
      const n = Math.floor((g.board.y + g.board.h - top - 2) / lineH);
      for (let i = 0; i < n; i++) {
        const t = new Text({ text: '', style: style(big ? 8 : 7, 0xe8f0e0) });
        t.resolution = this.textResolution;
        t.position.set(g.board.x + 4, top + i * lineH);
        this.boardTexts.push(t);
        this.content.addChildAt(t, this.content.getChildIndex(this.darkness));
      }
    }
    for (const t of [this.title, this.subtitle, this.footer, this.bigLabel, this.bubbleText]) t.resolution = this.textResolution;
    this.screenG.clear();
    this.stepsG.clear();
    this.drawnDark = -1;
    this.lastScreenFrame = -1;
    this.applyDetail();
  }

  update(info: RoomInfo): void {
    const prev = this.info;
    if (`${info.kind}|${info.width}` !== this.kindKey) this.build(info);
    this.info = info;
    const g = this.geo;
    const big = info.kind === 'main' || info.kind === 'chief';
    const compactish = info.kind === 'compact' || info.filler;
    const titleSize = big ? 10 : compactish ? 7 : 8;
    const setText = (t: Text, s: string) => {
      if (t.text !== s) t.text = s;
    };
    const lampRight = info.filler ? g.w : g.lamp.x - 8;
    setText(this.title, clip(info.title, Math.floor((Math.min(g.plaque.w, lampRight - g.plaque.x) - 8) / (titleSize * CHAR_W))));
    setText(this.subtitle, clip(info.subtitle, Math.floor((g.plaque.w - 8) / ((big ? 8 : 7) * CHAR_W))));
    const footerSize = compactish ? 6 : big ? 8 : 7;
    setText(this.footer, clip(info.footer, Math.floor((g.w - g.footer.x - 4) / (footerSize * CHAR_W))));
    if (g.board) {
      const maxChars = Math.floor((g.board.w - 8) / ((big ? 8 : 7) * CHAR_W));
      this.boardTexts.forEach((t, i) => {
        const line = info.board[i];
        setText(t, line ? clip(line.text, maxChars) : '');
        if (line && t.style.fill !== line.color) t.style.fill = line.color;
      });
    }
    // Low-zoom label: sized to the room so it never spills into neighbours.
    const bigSize = g.w < 200 ? 12 : 15;
    const bigText = clip(info.bigLabel, Math.floor((g.w - 20) / (bigSize * CHAR_W)));
    if (this.bigLabel.style.fontSize !== bigSize) this.bigLabel.style.fontSize = bigSize;
    setText(this.bigLabel, bigText);
    if (!prev || prev.bigLabel !== info.bigLabel || prev.width !== info.width) {
      this.bigLabelBg.clear();
      if (bigText) {
        const w = Math.min(g.w - 6, bigText.length * bigSize * CHAR_W + 14);
        this.bigLabelBg.rect(g.w / 2 - w / 2, 56 - bigSize, w, bigSize * 2).fill({ color: 0x0b090e, alpha: 0.82 }).stroke({ width: 2, color: 0x4b3d5e });
      }
    }
    this.lamp.texture = lampTexture(info.waiting ? '#f2c14e' : info.statusColor, info.lampOn);
    this.events(info, prev);
    if (!prev || prev.selected !== info.selected) this.drawOutline(performance.now());
    if (info.steps && g.board) this.drawSteps(info.steps, performance.now());

    // Speech bubble with the text being streamed (MessageDisplay hook).
    if (info.liveText) {
      const lines = info.liveText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-2)
        .map((l) => clip(l, 34));
      setText(this.bubbleText, lines.join('\n'));
      if (!prev || prev.liveText !== info.liveText) {
        const w = Math.max(...lines.map((l) => l.length), 4) * 7 * CHAR_W + 10;
        const h = lines.length * 9 + 8;
        this.bubbleBg.clear();
        this.bubbleBg.roundRect(0, 0, w, h, 3).fill(0xf4f1ea).stroke({ width: 1, color: 0x0b090e });
        this.bubbleText.position.set(5, 4);
        this.bubbleW = w;
        this.bubble.pivot.set(0, h + 5);
        this.bubbleTail = null;
      }
      this.bubble.visible = this.detail === 'full';
    } else this.bubble.visible = false;
  }

  /** One-shot effects triggered by changes in the data. */
  private events(info: RoomInfo, prev: RoomInfo | null): void {
    const g = this.geo;
    const s = g.mascotScale;
    const L = this.last;
    const now = performance.now();
    const headY = g.floorY - 14 * s;
    if (L.added >= 0 && info.added > L.added) this.fx.text(`+${info.added - L.added}`, this.mascotX + 10, headY, style(8, 0x7ee08f, true), { vx: 6, vy: -22 });
    if (L.removed >= 0 && info.removed > L.removed) this.fx.text(`-${info.removed - L.removed}`, this.mascotX + 22, headY + 6, style(8, 0xff8a8a, true), { vx: 10, vy: -18 });
    if (L.errors >= 0 && info.errorCount > L.errors) {
      this.flashUntil = now + 1800;
      this.shakeUntil = now + 600;
      const sx = g.screen ? g.screen.x + g.screen.w / 2 : this.mascotX;
      const sy = g.screen ? g.screen.y + g.screen.h / 2 : headY;
      this.fx.sparks(sx, sy, 18);
      this.fx.sparks(this.mascotX, headY, 8);
    }
    if (L.compactions >= 0 && info.compactions > L.compactions && g.board) {
      const b = g.board;
      this.fx.swirl(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 36);
      this.fx.text('compaction !', b.x + b.w / 2, b.y - 6, style(8, 0x6cc4ff, true), { vy: -10, life: 1800 });
    }
    let consumedTokens = false;
    if (L.tokens >= 0 && info.tokens - L.tokens >= 1500 && now - this.lastTokenFx > 700 && !info.filler) {
      this.lastTokenFx = now;
      consumedTokens = true;
      this.fx.text(`+${formatK(info.tokens - L.tokens)} tok`, g.footer.x + 40 + Math.random() * 60, g.footer.y - 2, style(7, 0x6cc4ff, true), { vy: -14, life: 1200 });
    }
    if (L.toolCount >= 0 && info.toolCount > L.toolCount && info.toolLabel && !info.filler) {
      this.fx.text(info.toolLabel, this.mascotX, headY - 10, style(7, 0xffe7a3, true), { vy: -12, life: 1000 });
    }
    // Celebration when the agent finishes, dust when it starts.
    if (prev && L.status && L.status !== 'done' && info.status === 'done' && !info.filler) this.fx.confetti(this.mascotX, headY, 26, 70);
    if (prev && L.status === 'starting' && info.status === 'running') this.fx.dust(this.mascotX - 10, g.floorY + 2, 20, 6);
    L.added = info.added;
    L.removed = info.removed;
    L.errors = info.errorCount;
    L.compactions = info.compactions;
    // Token deltas accumulate until shown (so small messages add up to one particle).
    if (L.tokens < 0 || consumedTokens || info.tokens < L.tokens) L.tokens = info.tokens;
    L.toolCount = info.toolCount;
    L.status = info.status;
  }

  /** Celebration triggered from outside (workflow finished, session over). */
  celebrate(big = false): void {
    if (!this.geo) return;
    this.fx.confetti(this.mascotX, this.geo.floorY - 30, big ? 60 : 30, big ? 110 : 75);
    if (big) {
      this.fx.confetti(this.geo.w * 0.25, this.geo.floorY - 40, 30, 90);
      this.fx.confetti(this.geo.w * 0.75, this.geo.floorY - 40, 30, 90);
    }
  }

  private drawOutline(now: number): void {
    const g = this.geo;
    const info = this.info;
    if (!g) return;
    this.outline.clear();
    if (info?.selected) {
      // marching ants
      this.outline.rect(-2, -2, g.w + 4, g.h + 4).stroke({ width: 3, color: 0x0b090e });
      dashedPath(
        this.outline,
        [
          [-2, -2],
          [g.w + 2, -2],
          [g.w + 2, g.h + 2],
          [-2, g.h + 2],
          [-2, -2],
        ],
        6,
        6,
        Math.floor(now / 80) % 12,
      );
      this.outline.stroke({ width: 3, color: 0xf2c14e });
    } else if (this.hover && info && !info.filler) {
      this.outline.rect(-1, -1, g.w + 2, g.h + 2).stroke({ width: 2, color: 0xece6f2, alpha: 0.75 });
    }
  }

  private drawSteps(steps: StepBox[], now: number): void {
    const b = this.geo.board;
    if (!b) return;
    const g = this.stepsG;
    g.clear();
    const n = steps.length;
    const boxW = Math.max(10, Math.min(28, Math.floor((b.w - 8 - (n - 1) * 6) / Math.max(1, n))));
    steps.forEach((st, i) => {
      const x = b.x + 4 + i * (boxW + 6);
      const y = b.y + 4;
      const pulse = st.state === 'active' ? 0.55 + 0.45 * Math.abs(Math.sin(now / 260)) : 1;
      g.rect(x, y, boxW, 10).fill({ color: STEP_COLORS[st.state], alpha: pulse });
      g.rect(x, y, boxW, 10).stroke({ width: 1, color: 0x0b090e });
      for (let k = 0; k < Math.min(st.count, Math.floor((boxW - 2) / 3)); k++) g.rect(x + 2 + k * 3, y + 3, 2, 4).fill(0x1a1420);
      if (i < n - 1) g.rect(x + boxW + 1, y + 4, 4, 2).fill(0x8a7aa8);
    });
  }

  /**
   * Leaving the base: the mascot walks out through the door, then the room is filled back in
   * (bottom → top, with dust). Rooms that were never seen just fade.
   */
  markRemoving(now: number, animated = true): void {
    if (this.removing) return;
    this.removing = true;
    this.removeStart = now;
    this.removeAt = now + (animated && this.built && this.info && !this.info.filler ? LEAVE_MS : 350);
    if (this.removeAt - now > 400 && this.geo) {
      this.revealMask.clear().rect(0, 0, this.geo.w, this.geo.h).fill(0xffffff);
      this.revealMask.visible = true;
      this.content.mask = this.revealMask;
    }
    this.eventMode = 'none';
    this.hover = false;
    this.outline.clear();
  }

  private removeStart = 0;

  /** Construction: hazard-striped scaffold drawn around the room, then a bottom → top reveal. */
  private tickBuild(age: number, dt: number): void {
    const g = this.geo;
    const k = Math.min(1, age / BUILD_MS);
    const scaffoldK = Math.min(1, age / 380);
    const revealK = Math.max(0, Math.min(1, (age - 260) / (BUILD_MS - 360)));
    this.scaffold.clear();
    if (k < 1) {
      const perim = 2 * (g.w + g.h);
      dashedPath(
        this.scaffold,
        [
          [0, g.h],
          [0, 0],
          [g.w, 0],
          [g.w, g.h],
          [0, g.h],
        ],
        4,
        4,
        0,
        perim * scaffoldK,
      );
      this.scaffold.stroke({ width: 3, color: 0xf2c14e });
      if (scaffoldK >= 1) for (let x = 24; x < g.w; x += 48) this.scaffold.rect(x, 0, 2, g.h).fill({ color: 0x8a7a6a, alpha: 1 - revealK });
    }
    const top = Math.round(g.h * (1 - revealK));
    this.revealMask.clear().rect(0, top, g.w, g.h - top).fill(0xffffff);
    if (revealK > 0 && revealK < 1 && Math.floor(age / 90) !== Math.floor((age - dt * 1000) / 90)) this.fx.dust(0, top, g.w, 4);
    if (k >= 1) {
      this.built = true;
      this.scaffold.clear();
      // Masks cost a stencil pass per room: only keep one while building / leaving.
      this.content.mask = null;
      this.revealMask.clear();
      this.revealMask.visible = false;
      this.fx.dust(0, g.h - 4, g.w, 14);
    }
  }

  /** Returns false when the exit animation is over and the room can be destroyed. */
  tick(now: number, animFrame: number, fastFrame: number, visible: boolean): boolean {
    const info = this.info;
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!info) return true;
    const g = this.geo;
    const age = now - this.bornAt;

    if (this.removing) {
      const total = this.removeAt - this.removeStart;
      const k = Math.min(1, (now - this.removeStart) / total);
      if (total <= 400) this.alpha = 1 - k;
      else {
        // phase 1 (45 %): walk to the door — phase 2: the room is filled in from the bottom
        const fill = Math.max(0, (k - 0.45) / 0.55);
        const top = Math.round(g.h * fill);
        this.revealMask.clear().rect(0, 0, g.w, g.h - top).fill(0xffffff);
        if (fill > 0 && fill < 1 && Math.floor(now / 90) !== Math.floor((now - dt * 1000) / 90)) this.fx.dust(0, g.h - top, g.w, 5);
      }
      if (k >= 1) return false;
    } else {
      if (this.alpha !== 1) this.alpha = 1;
      if (!this.built) this.tickBuild(age, dt);
    }

    // glide to target (+ shake on errors)
    const dx = this.targetX - this.position.x;
    const dy = this.targetY - this.position.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.position.set(this.position.x + dx * 0.18, this.position.y + dy * 0.18);
    else if (dx !== 0 || dy !== 0) this.position.set(this.targetX, this.targetY);
    this.content.x = now < this.shakeUntil ? Math.round((Math.random() - 0.5) * 4) : 0;

    // lights: flicker on after construction, dim when the agent is done
    const lightAge = age - BUILD_MS * 0.85;
    const targetDark = info.filler ? 0.22 : info.dim ? 0.5 : 0;
    if (lightAge < 700 && !info.filler) {
      const on = lightAge > 150 && (lightAge > 550 || Math.floor(lightAge / 70) % 3 !== 0);
      this.darkAlpha = on ? targetDark : 0.85;
    } else this.darkAlpha += (targetDark - this.darkAlpha) * Math.min(1, dt * 3);
    if (Math.abs(this.darkAlpha - this.drawnDark) > 0.008) {
      this.drawnDark = this.darkAlpha;
      this.darkness.clear();
      if (this.darkAlpha > 0.01) this.darkness.rect(0, 0, g.w, g.h).fill({ color: 0x05030a, alpha: this.darkAlpha });
    }

    if (!visible) {
      if (this.removing) return now < this.removeAt;
      this.mascotX = g.stations[info.station];
      this.fx.update(now, dt);
      return true;
    }

    if (!info.filler) this.tickMascot(info, now, dt, age, animFrame, fastFrame);

    // monitor screen: scrolling code while the agent works
    const screenKey = info.screenActive ? fastFrame : -2;
    if (g.screen && screenKey !== this.lastScreenFrame) {
      this.lastScreenFrame = screenKey;
      const sc = g.screen;
      this.screenG.clear();
      if (info.screenActive) {
        for (let i = 0; i < 4; i++) {
          const w = 4 + ((fastFrame * 7 + i * 5) % (sc.w - 6));
          this.screenG.rect(sc.x + 2, sc.y + 1 + i * 2.5, w, 1).fill(i === 3 ? 0xffe7a3 : 0x6cc4ff);
        }
        this.screenG.rect(sc.x, sc.y, sc.w, sc.h).fill({ color: 0x6cc4ff, alpha: 0.06 + 0.05 * (fastFrame % 2) });
      } else if (!info.filler) {
        this.screenG.rect(sc.x + 2, sc.y + 2, 6, 1).fill({ color: 0x6cc4ff, alpha: 0.5 });
      }
    }
    if (info.steps && Math.floor(now / 60) % 2 === 0) this.drawSteps(info.steps, now);
    if (info.selected && Math.floor(now / 80) !== Math.floor((now - dt * 1000) / 80)) this.drawOutline(now);

    this.fx.update(now, dt);

    // red flash on error
    const flashing = now < this.flashUntil;
    if (flashing || this.flash.visible) {
      this.flash.clear();
      if (flashing) {
        const a = 0.14 + 0.2 * Math.abs(Math.sin(now / 90));
        this.flash.rect(0, 0, g.w, g.h).fill({ color: 0xff3b3b, alpha: a });
        this.flash.visible = true;
      } else this.flash.visible = false;
    }
    return true;
  }

  private tickMascot(info: RoomInfo, now: number, dt: number, age: number, animFrame: number, fastFrame: number): void {
    const g = this.geo;
    // Idle mascots wander between stations; otherwise they go where the work is.
    let target = this.removing ? g.stations.door : g.stations[info.station];
    if (info.anim === 'idle' && !info.waiting) {
      if (now > this.nextWander) {
        const options = [g.stations.desk, g.stations.read, g.stations.board, g.stations.rest];
        this.wanderTarget = options[Math.floor(Math.random() * options.length)] ?? target;
        this.nextWander = now + 5000 + Math.random() * 5000;
      }
      if (this.wanderTarget !== null) target = this.wanderTarget;
    } else this.wanderTarget = null;
    // At the door the mascot steps out (hidden) while the room is filled in.
    const appeared = (this.built || age > BUILD_MS * 0.6) && !(this.removing && Math.abs(this.mascotX - g.stations.door) < 2);
    const diff = target - this.mascotX;
    const walking = Math.abs(diff) > 1.5 && appeared;
    if (walking) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), WALK_SPEED * dt * (g.mascotScale / 2) * 1.6);
      this.mascotX += step;
      this.facing = Math.sign(diff) || this.facing;
    } else if (Math.abs(diff) <= 1.5) this.mascotX = target;
    const anim: Anim = walking ? 'walk' : this.removing ? 'idle' : info.anim;
    // natural blinking: idle shows the blink frame only briefly
    const frame = anim === 'idle' ? (now % 3400 < 140 ? 1 : 0) : walking || anim === 'type' ? fastFrame : animFrame;
    this.mascot.texture = mascotTexture(info.seed, { chief: info.chief, canonical: info.canonical }, anim, frame, info.spriteSet);
    const s = g.mascotScale;
    const bob = anim === 'celebrate' ? (animFrame % 2) * -2 * s : walking ? -(fastFrame % 2) : 0;
    const jitter = anim === 'error' ? ((fastFrame % 2) - 0.5) * 2 : 0;
    const podium = info.chief ? -8 : 0;
    this.mascot.visible = appeared;
    this.mascot.position.set(Math.round(this.mascotX + jitter), g.floorY + 4 + bob + podium);
    this.mascot.scale.set(s * (walking ? this.facing : 1), s);

    // prop
    const showProp = !walking && info.prop !== 'none' && anim !== 'sleep' && anim !== 'celebrate' && anim !== 'error';
    const propKind: PropKind | 'none' = info.waiting ? 'question' : showProp ? info.prop : 'none';
    if (propKind === 'none') this.prop.visible = false;
    else {
      this.prop.visible = true;
      this.prop.texture = propTexture(propKind, propKind === 'bubble' || propKind === 'question' ? animFrame : fastFrame);
      const ps = Math.max(1, s - 1);
      this.prop.scale.set(ps);
      const pw = this.prop.texture.width * ps;
      const ph = this.prop.texture.height * ps;
      const feet = g.floorY + 4 + podium;
      const qBob = propKind === 'question' ? Math.round(Math.sin(now / 180) * 2) : 0;
      if (propKind === 'keyboard') this.prop.position.set(this.mascotX - pw / 2, feet - 4 * s - ph / 2);
      else if (propKind === 'scroll') this.prop.position.set(this.mascotX - pw / 2, feet - 6 * s - ph / 2);
      // Bubbles go on the side away from the board so they never hide its text.
      else if (info.station === 'board') this.prop.position.set(this.mascotX - 5 * s - pw, feet - 14 * s - ph + qBob);
      else this.prop.position.set(this.mascotX + 5 * s, feet - 14 * s - ph + qBob);
    }
    if (this.bubble.visible) {
      const leftward = this.mascotX > g.w * 0.45;
      const bx = leftward ? Math.max(4, this.mascotX - this.bubbleW - 2) : this.mascotX + 4;
      const tail = leftward ? 'right' : 'left';
      if (tail !== this.bubbleTail) {
        this.bubbleTail = tail;
        const h = this.bubble.pivot.y - 5;
        const w = this.bubbleW;
        this.bubbleBg.clear();
        this.bubbleBg.roundRect(0, 0, w, h, 3).fill(0xf4f1ea).stroke({ width: 1, color: 0x0b090e });
        const tx = tail === 'left' ? 8 : w - 14;
        this.bubbleBg.poly([tx, h, tx + 6, h, tail === 'left' ? tx : tx + 6, h + 5]).fill(0xf4f1ea);
      }
      this.bubble.position.set(Math.round(bx), g.floorY + 4 + podium - 15 * s);
    }

    if (anim === 'sleep' && now - this.lastZzz > 1600) {
      this.lastZzz = now;
      this.fx.sprite(zzzTexture(), this.mascotX + 6 * s, g.floorY - 12 * s, { vx: 5, vy: -8, life: 2400 });
    }
    if (!this.built && appeared && Math.floor(age / 120) !== Math.floor((age - dt * 1000) / 120)) {
      this.fx.sprite(sparkleTexture(fastFrame), this.mascotX + (Math.random() - 0.5) * 24, g.floorY - Math.random() * 30, { vy: -10, life: 600 });
    }

    // glows: rotating alarm on errors, amber halo while waiting
    this.glowG.clear();
    const lx = g.lamp.x;
    const ly = g.lamp.y + 6;
    if (info.status === 'error') {
      this.glowG.circle(lx, ly, 14).fill({ color: 0xff3b3b, alpha: 0.15 + 0.25 * Math.abs(Math.sin(now / 220)) });
      const ang = (now / 300) % (Math.PI * 2);
      this.glowG.poly([lx, ly, lx + Math.cos(ang) * 40 - 6, ly + Math.sin(ang) * 40, lx + Math.cos(ang) * 40 + 6, ly + Math.sin(ang) * 40]).fill({ color: 0xff3b3b, alpha: 0.12 });
    } else if (info.waiting) {
      this.glowG.circle(lx, ly, 12).fill({ color: 0xf2c14e, alpha: 0.12 + 0.18 * Math.abs(Math.sin(now / 300)) });
    }
  }

  /** Seed of the mascot/room textures (released when the room goes away). */
  get seed(): string | null {
    return this.info?.seed ?? null;
  }

  get bounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.targetX, y: this.targetY, w: this.geo?.w ?? 0, h: this.geo?.h ?? 0 };
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.fx.clear();
    super.destroy(options);
  }
}
