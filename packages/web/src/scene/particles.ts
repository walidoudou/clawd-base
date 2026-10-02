import { Container, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';

/** Small physics particle system (pixels, sprites, labels) with gravity and fade-out. */
interface Particle {
  obj: Sprite | Text;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  drag: number;
  born: number;
  life: number;
  /** Optional attractor (compaction swirl). */
  target?: { x: number; y: number; strength: number };
  fade: boolean;
  /** Called when the particle dies (firework rockets burst). */
  onDeath?: (x: number, y: number) => void;
}

const MAX = 600;

export class ParticleSystem {
  private readonly list: Particle[] = [];
  textResolution = 2;

  constructor(private readonly layer: Container) {}

  get size(): number {
    return this.list.length;
  }

  pixel(x: number, y: number, color: number, opts: { vx?: number; vy?: number; ay?: number; size?: number; life?: number; drag?: number; target?: Particle['target']; onDeath?: Particle['onDeath'] } = {}): void {
    if (this.list.length >= MAX) return;
    const s = new Sprite(Texture.WHITE);
    const size = opts.size ?? 2;
    s.width = size;
    s.height = size;
    s.tint = color;
    s.anchor.set(0.5);
    this.layer.addChild(s);
    this.list.push({ obj: s, x, y, vx: opts.vx ?? 0, vy: opts.vy ?? 0, ay: opts.ay ?? 0, drag: opts.drag ?? 0, born: performance.now(), life: opts.life ?? 900, target: opts.target, fade: true, onDeath: opts.onDeath });
  }

  sprite(texture: Texture, x: number, y: number, opts: { vx?: number; vy?: number; ay?: number; life?: number; scale?: number } = {}): void {
    if (this.list.length >= MAX) return;
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.scale.set(opts.scale ?? 1);
    this.layer.addChild(s);
    this.list.push({ obj: s, x, y, vx: opts.vx ?? 0, vy: opts.vy ?? 0, ay: opts.ay ?? 0, drag: 0, born: performance.now(), life: opts.life ?? 1200, fade: true });
  }

  text(content: string, x: number, y: number, style: TextStyleOptions, opts: { vx?: number; vy?: number; life?: number } = {}): void {
    if (this.list.length >= MAX) return;
    const t = new Text({ text: content, style });
    t.resolution = this.textResolution;
    t.anchor.set(0.5);
    this.layer.addChild(t);
    this.list.push({ obj: t, x, y, vx: opts.vx ?? 0, vy: opts.vy ?? -16, ay: 0, drag: 0, born: performance.now(), life: opts.life ?? 1300, fade: true });
  }

  /** Confetti burst (celebrations). */
  confetti(x: number, y: number, count = 28, power = 70): void {
    const colors = [0xf2c14e, 0x7ee08f, 0x6cc4ff, 0xff8a8a, 0xc58cff, 0xffffff, 0xd77757];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const v = power * (0.5 + Math.random() * 0.7);
      this.pixel(x, y, colors[i % colors.length] as number, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 120, size: Math.random() < 0.3 ? 3 : 2, life: 1300 + Math.random() * 700, drag: 0.6 });
    }
  }

  /** Sparks (errors). */
  sparks(x: number, y: number, count = 14): void {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const v = 40 + Math.random() * 60;
      this.pixel(x, y, Math.random() < 0.5 ? 0xffd479 : 0xff8a3d, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 160, size: 1 + Math.round(Math.random()), life: 500 + Math.random() * 400 });
    }
  }

  /** Dust puffs (construction, arrivals). */
  dust(x: number, y: number, w: number, count = 10): void {
    for (let i = 0; i < count; i++) {
      this.pixel(x + Math.random() * w, y, 0x8a7a6a, { vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 20, ay: 10, size: 2 + Math.round(Math.random()), life: 700 + Math.random() * 500, drag: 1.2 });
    }
  }

  /** Paper bits sucked into a point (compaction). */
  swirl(cx: number, cy: number, w: number, h: number, count = 30): void {
    for (let i = 0; i < count; i++) {
      const x = cx + (Math.random() - 0.5) * w;
      const y = cy + (Math.random() - 0.5) * h;
      const tangent = (Math.random() < 0.5 ? 1 : -1) * 40;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      this.pixel(x, y, Math.random() < 0.7 ? 0xf4f1ea : 0x6cc4ff, { vx: (-dy / d) * tangent, vy: (dx / d) * tangent, size: 2, life: 1100 + Math.random() * 400, target: { x: cx, y: cy, strength: 260 } });
    }
  }

  update(now: number, dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i] as Particle;
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        p.onDeath?.(p.x, p.y);
        p.obj.destroy();
        this.list.splice(i, 1);
        continue;
      }
      if (p.target) {
        const dx = p.target.x - p.x;
        const dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * p.target.strength * dt;
        p.vy += (dy / d) * p.target.strength * dt;
        if (d < 3) p.life = Math.min(p.life, now - p.born + 1);
      }
      p.vy += p.ay * dt;
      if (p.drag) {
        p.vx *= 1 - Math.min(1, p.drag * dt);
        p.vy *= 1 - Math.min(1, p.drag * dt * 0.3);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.obj.position.set(Math.round(p.x), Math.round(p.y));
      if (p.fade) p.obj.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }

  clear(): void {
    for (const p of this.list) p.obj.destroy();
    this.list.length = 0;
  }
}
