import { getSpriteSet, type Anim, type PaletteRole, type SpriteSet } from './sprites/index.ts';

/** Clawd's canonical body color, rgb(215,119,87). */
export const CLAWD_ORANGE = '#D77757';

export const ACCESSORIES = ['none', 'tophat', 'beanie', 'cap', 'glasses', 'headset', 'cape', 'bow', 'flower', 'scarf'] as const;
export const CHIEF_ACCESSORIES = ['crown', 'chefhat'] as const;
export const DETAILS = ['none', 'blush', 'freckles', 'antenna', 'spot', 'sparkle'] as const;
export type Accessory = (typeof ACCESSORIES)[number] | (typeof CHIEF_ACCESSORIES)[number];
export type Detail = (typeof DETAILS)[number];

export interface MascotLook {
  seed: number;
  body: string;
  bodyShade: string;
  leg: string;
  accessory: Accessory;
  accessoryColor: string;
  accessoryShade: string;
  detail: Detail;
  /** Workflow chiefs get a crown or chef hat. */
  chief: boolean;
}

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded PRNG → floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor))).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`.toUpperCase();
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;

/**
 * Deterministic mascot from an id: same id ⇒ same look, every time, everywhere.
 * `canonical` returns the original Clawd (used for the main session).
 */
export function generateMascot(id: string, opts: { chief?: boolean; canonical?: boolean; canonicalColor?: string } = {}): MascotLook {
  const seed = hashString(id);
  if (opts.canonical) {
    const body = opts.canonicalColor ?? CLAWD_ORANGE;
    return {
      seed,
      body,
      bodyShade: shade(body, 0.78),
      leg: shade(body, 0.85),
      accessory: opts.chief ? 'crown' : 'none',
      accessoryColor: '#F2C14E',
      accessoryShade: '#B8862B',
      detail: 'none',
      chief: !!opts.chief,
    };
  }
  const rng = mulberry32(seed);
  // Hue anywhere on the wheel, but keep Clawd's warm, soft saturation/lightness.
  const hue = Math.floor(rng() * 360);
  const body = hsl(hue, 0.5 + rng() * 0.2, 0.52 + rng() * 0.12);
  const accHue = hue + 150 + rng() * 60;
  const accessoryColor = hsl(accHue, 0.55 + rng() * 0.25, 0.45 + rng() * 0.15);
  const accessory: Accessory = opts.chief ? pick(rng, CHIEF_ACCESSORIES) : pick(rng, ACCESSORIES.slice(1));
  // Antennas would collide with hats.
  let detail = pick(rng, DETAILS);
  if (detail === 'antenna' && ['tophat', 'beanie', 'cap', 'crown', 'chefhat', 'bow', 'flower'].includes(accessory)) detail = 'blush';
  return {
    seed,
    body,
    bodyShade: shade(body, 0.78),
    leg: shade(body, 0.85),
    accessory,
    accessoryColor,
    accessoryShade: shade(accessoryColor, 0.7),
    detail,
    chief: !!opts.chief,
  };
}

/** Accessory overlays, positioned relative to (centerX, headTop) of the sprite set. */
interface Overlay {
  dx: number;
  dy: number;
  rows: string[];
  /** Drawn behind the body. */
  back?: boolean;
}

const OVERLAY_PALETTE: Record<string, PaletteRole> = { A: 'accessory', a: 'accessoryShade', Y: 'gold', w: 'white', K: 'black', R: 'gem', P: 'blush', s: 'bodyShade' };

const ACCESSORY_OVERLAYS: Record<Accessory, Overlay[]> = {
  none: [],
  tophat: [{ dx: -3, dy: -4, rows: ['.AAAA.', '.AAAA.', '.aaaa.', 'AAAAAA'] }],
  beanie: [{ dx: -6, dy: -3, rows: ['.....ww.....', '...AAAAAA...', 'AaAaAaAaAaAa'] }],
  cap: [{ dx: -6, dy: -2, rows: ['..AAAAAAAA......', 'AAAAAAAAAAAAaaaa'] }],
  glasses: [{ dx: -6, dy: 1, rows: ['.KKK....KKK.', '.K.KKKKKK.K.', '.K.K....K.K.', '.KKK....KKK.'] }],
  headset: [
    { dx: -6, dy: -1, rows: ['aaaaaaaaaaaa'] },
    { dx: -7, dy: 1, rows: ['A............A', 'A............A', 'A............A'] },
    { dx: 4, dy: 4, rows: ['.a', 'a.'] },
  ],
  cape: [{ dx: -7, dy: 1, rows: ['A............A', 'A............A', 'A............A', 'A............A', 'AA..........AA', 'AA..........AA', 'aa..........aa'], back: true }],
  bow: [{ dx: 1, dy: -2, rows: ['A...A', 'AAaAA', 'A...A'] }],
  flower: [{ dx: 2, dy: -3, rows: ['.w.', 'wYw', '.w.'] }],
  scarf: [{ dx: -6, dy: 5, rows: ['AAAAAAAAAAAA'] }, { dx: 3, dy: 6, rows: ['AA', 'aA'] }],
  crown: [{ dx: -5, dy: -3, rows: ['Y...YY...Y', 'YY.YRRY.YY', 'YYYYYYYYYY'] }],
  chefhat: [{ dx: -5, dy: -4, rows: ['.wwwwwwww.', 'wwwwwwwwww', 'wwwwwwwwww', '.KKKKKKKK.'] }],
};

const DETAIL_OVERLAYS: Record<Detail, Overlay[]> = {
  none: [],
  blush: [{ dx: -5, dy: 4, rows: ['P........P'] }],
  freckles: [{ dx: -4, dy: 4, rows: ['s.s....s.s'] }],
  antenna: [{ dx: 0, dy: -3, rows: ['Y', 's', 's'] }],
  spot: [{ dx: 1, dy: 1, rows: ['ss', 's.'] }],
  sparkle: [{ dx: -2, dy: 4, rows: ['w...w'] }],
};

function roleColor(role: PaletteRole | string, look: MascotLook): string | null {
  switch (role) {
    case 'body': return look.body;
    case 'bodyShade': return look.bodyShade;
    case 'bodyLight': return shade(look.body, 1.22);
    case 'leg': return look.leg;
    case 'eye': return '#111111';
    case 'eyeLight': return '#FFFFFF';
    case 'accessory': return look.accessoryColor;
    case 'accessoryShade': return look.accessoryShade;
    case 'gold': return '#F2C14E';
    case 'white': return '#F4F1EA';
    case 'black': return '#1A1A1A';
    case 'blush': return '#F28B9B';
    case 'gem': return '#D94A4A';
    default: return role.startsWith('#') ? role : null;
  }
}

export interface PixelGrid {
  width: number;
  height: number;
  /** Row-major colors, null = transparent. */
  pixels: Array<string | null>;
}

/** Compose sprite frame + accessory + detail into a color grid. Pure and deterministic. */
export function composeMascot(look: MascotLook, anim: Anim, frame: number, set: SpriteSet = getSpriteSet(null)): PixelGrid {
  const frames = set.frames[anim] ?? set.frames.idle;
  const grid = frames[((frame % frames.length) + frames.length) % frames.length] ?? frames[0] ?? [];
  const { width, height } = set;
  const pixels: Array<string | null> = new Array<string | null>(width * height).fill(null);
  // Body squashes (sleep) shift the head: find the first non-empty row to anchor hats.
  let headTop = set.anchors.headTop;
  for (let y = 0; y < grid.length; y++) {
    if (/[^.]/.test((grid[y] ?? '').slice(3, width - 3))) { headTop = y; break; }
  }
  const draw = (ov: Overlay) => {
    ov.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx] as string;
        if (ch === '.') continue;
        const x = set.anchors.centerX + ov.dx + rx;
        const y = headTop + ov.dy + ry;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const role = OVERLAY_PALETTE[ch];
        if (role) pixels[y * width + x] = roleColor(role, look);
      }
    });
  };
  const overlays = [...ACCESSORY_OVERLAYS[look.accessory], ...DETAIL_OVERLAYS[look.detail]];
  overlays.filter((o) => o.back).forEach(draw);
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      if (ch === '.') continue;
      const role = set.palette[ch];
      if (role) pixels[y * width + x] = roleColor(role, look);
    }
  });
  // Details only paint over body pixels (so blush never floats in the air), accessories always.
  for (const ov of overlays.filter((o) => !o.back)) {
    if (DETAIL_OVERLAYS[look.detail].includes(ov) && look.detail !== 'antenna') {
      ov.rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx] as string;
          if (ch === '.') continue;
          const x = set.anchors.centerX + ov.dx + rx;
          const y = headTop + ov.dy + ry;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const cur = pixels[y * width + x];
          if (cur === look.body || cur === look.bodyShade || cur === shade(look.body, 1.22)) {
            const role = OVERLAY_PALETTE[ch];
            if (role) pixels[y * width + x] = roleColor(role, look);
          }
        }
      });
    } else draw(ov);
  }
  return { width, height, pixels };
}

/** RGBA buffer for canvas ImageData / textures. */
export function gridToRgba(g: PixelGrid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  g.pixels.forEach((c, i) => {
    if (!c) return;
    const n = parseInt(c.slice(1), 16);
    out[i * 4] = (n >> 16) & 255;
    out[i * 4 + 1] = (n >> 8) & 255;
    out[i * 4 + 2] = n & 255;
    out[i * 4 + 3] = 255;
  });
  return out;
}

/** Which animation an agent should play, from its live state. */
export function animationFor(state: { status: string; currentTool: string | null }, now: number, endedAt: number | null): Anim {
  if (state.status === 'error') return 'error';
  if (state.status === 'done') return endedAt !== null && now - endedAt < 4000 ? 'celebrate' : 'sleep';
  if (state.status === 'starting') return 'walk';
  const tool = state.currentTool;
  if (!tool) return state.status === 'idle' ? 'idle' : 'think';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'type';
  if (/^(Read|Grep|Glob|NotebookRead|WebFetch|WebSearch|LS)$/.test(tool)) return 'read';
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/.test(tool)) return 'type';
  if (/^(Agent|Task|Workflow)$/.test(tool)) return 'walk';
  return 'think';
}

/** Prop shown next to the mascot for a tool (scroll, keyboard, console…). */
export function propFor(tool: string | null): 'scroll' | 'keyboard' | 'console' | 'bubble' | 'none' {
  if (!tool) return 'bubble';
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'keyboard';
  if (/^(Read|Grep|Glob|NotebookRead|WebFetch|WebSearch|LS)$/.test(tool)) return 'scroll';
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/.test(tool)) return 'console';
  return 'bubble';
}
