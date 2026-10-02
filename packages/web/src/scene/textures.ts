import { Texture, TextureSource } from 'pixi.js';
import { composeMascot, generateMascot, getSpriteSet, gridToRgba, type Anim, type MascotLook } from '@dash/shared';
import {
  drawBubble,
  drawDirtTile,
  drawElevatorCab,
  drawGrassTile,
  drawHut,
  drawKeyboard,
  drawQuestion,
  drawRockTile,
  drawRoom,
  drawScroll,
  drawSparkle,
  drawStatusLamp,
  drawTree,
  drawZzz,
  makeCanvas,
  type RoomKind,
} from './tiles.ts';

// Pixel-perfect: nearest-neighbour sampling for every texture.
TextureSource.defaultOptions.scaleMode = 'nearest';

const cache = new Map<string, Texture>();
const looks = new Map<string, MascotLook>();

function cached(key: string, make: () => HTMLCanvasElement): Texture {
  let t = cache.get(key);
  if (!t) {
    t = Texture.from(make());
    t.source.scaleMode = 'nearest';
    cache.set(key, t);
  }
  return t;
}

export function mascotLook(seed: string, opts: { chief?: boolean; canonical?: boolean }, spriteSet = 'mole'): MascotLook {
  const canonicalColor = getSpriteSet(spriteSet).canonicalColor;
  const key = `${seed}|${opts.chief ? 1 : 0}|${opts.canonical ? 1 : 0}|${spriteSet}`;
  let l = looks.get(key);
  if (!l) looks.set(key, (l = generateMascot(seed, { ...opts, ...(canonicalColor ? { canonicalColor } : {}) })));
  return l;
}

export function mascotTexture(seed: string, opts: { chief?: boolean; canonical?: boolean }, anim: Anim, frame: number, spriteSet: string): Texture {
  const set = getSpriteSet(spriteSet);
  const frames = set.frames[anim] ?? set.frames.idle;
  const f = frame % frames.length;
  return cached(`m|${spriteSet}|${seed}|${opts.chief ? 1 : 0}|${opts.canonical ? 1 : 0}|${anim}|${f}`, () => {
    const g = composeMascot(mascotLook(seed, opts, spriteSet), anim, f, set);
    const { canvas, ctx } = makeCanvas(g.width, g.height);
    ctx.putImageData(new ImageData(gridToRgba(g) as Uint8ClampedArray<ArrayBuffer>, g.width, g.height), 0, 0);
    return canvas;
  });
}

function drop(key: string): void {
  const tex = cache.get(key);
  if (!tex) return;
  cache.delete(key);
  tex.destroy(true);
}

/** Destroy every cached texture (mascot frames + room backgrounds) derived from a seed. */
export function releaseSeed(seed: string): void {
  for (const key of [...cache.keys()]) {
    const parts = key.split('|');
    if ((parts[0] === 'm' || parts[0] === 'r') && parts[2] === seed) drop(key);
  }
  for (const key of [...looks.keys()]) if (key.startsWith(`${seed}|`)) looks.delete(key);
}

export function releaseRoomTexture(kind: RoomKind, seed: string, width: number): void {
  drop(`r|${kind}|${seed}|${width}`);
}

/** Number of cached textures (diagnostics/tests). */
export function cachedTextureCount(): number {
  return cache.size;
}

export function roomTexture(kind: RoomKind, seed: string, width: number): Texture {
  return cached(`r|${kind}|${seed}|${width}`, () => drawRoom(kind, seed, width));
}

export type PropKind = 'keyboard' | 'scroll' | 'bubble' | 'question';
export function propTexture(kind: PropKind, frame: number): Texture {
  const f = kind === 'bubble' ? frame % 3 : frame % 2;
  return cached(`p|${kind}|${f}`, () => (kind === 'keyboard' ? drawKeyboard(f) : kind === 'scroll' ? drawScroll(f) : kind === 'question' ? drawQuestion(f) : drawBubble(f)));
}

export const zzzTexture = (): Texture => cached('zzz', drawZzz);
export const sparkleTexture = (frame: number): Texture => cached(`sparkle|${frame % 2}`, () => drawSparkle(frame));
export const lampTexture = (color: string, on: boolean): Texture => cached(`lamp|${color}|${on ? 1 : 0}`, () => drawStatusLamp(color, on));
export const rockTexture = (): Texture => cached('rock', drawRockTile);
export const dirtTexture = (): Texture => cached('dirt', drawDirtTile);
export const grassTexture = (): Texture => cached('grass', drawGrassTile);
export const treeTexture = (seed: number): Texture => cached(`tree|${seed % 6}`, () => drawTree(seed % 6));
export const hutTexture = (): Texture => cached('hut', drawHut);
export const elevatorTexture = (): Texture => cached('elevator', drawElevatorCab);
