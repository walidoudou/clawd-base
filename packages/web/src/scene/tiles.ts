/**
 * Code-generated pixel art for the underground base: room interiors (side cut-away),
 * filler rooms, rock, surface props and small animated props. No external assets.
 */
import { mulberry32, hashString } from '@dash/shared';

export const TILE = 16;
/** Every room has the same height so the base reads as a building with levels. */
export const ROOM_H = 128;
/** Concrete slab (with cable duct) between levels. */
export const SLAB = 16;
export const LEVEL = ROOM_H + SLAB;
export const FLOOR_Y = 104;

export const PAL = {
  outline: '#0b090e',
  ceiling: '#2a2233',
  wallA: '#3b2f4a',
  wallB: '#352a43',
  wallTrim: '#4b3d5e',
  floorA: '#6b4a35',
  floorB: '#5e402d',
  floorLine: '#4a3222',
  floorShine: '#7a5740',
  baseboard: '#241c2c',
  deskTop: '#9a6a44',
  deskSide: '#7a5034',
  deskLeg: '#5a3a26',
  monitor: '#1d1a24',
  screen: '#2f5f80',
  screenGlow: '#6cc4ff',
  board: '#1f2b24',
  boardFrame: '#8a5f3c',
  plaque: '#2a2233',
  plaqueRim: '#c9a25a',
  plantPot: '#b5653f',
  leaf: '#4fa35f',
  leafDark: '#357a45',
  lampMetal: '#5a5068',
  bulb: '#ffe7a3',
  book1: '#d77757',
  book2: '#6cc4ff',
  book3: '#f2c14e',
  book4: '#9b7ad6',
  shelf: '#7a5034',
  rug: '#5a2f45',
  rugEdge: '#7a3f5c',
  gold: '#f2c14e',
  rackA: '#2b2735',
  rackB: '#3a3448',
  led1: '#7ee08f',
  led2: '#6cc4ff',
  led3: '#ff8a8a',
  crate: '#8a6238',
  crateDark: '#6a4a2a',
  metal: '#6f6a7d',
  metalDark: '#4a4658',
  pipe: '#5b6b78',
  pipeDark: '#3e4a55',
  rock: '#2b2420',
  rockDark: '#221c19',
  rockLight: '#3a302a',
  dirt: '#4a3626',
  dirtDark: '#3a2a1e',
  grass: '#3f8f4a',
  grassLight: '#5cb85f',
  concrete: '#4a4552',
  concreteDark: '#38343f',
  concreteLight: '#5a5462',
} as const;

type Ctx = CanvasRenderingContext2D;

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

// ───────────── base tiles ─────────────

function wallTile(ctx: Ctx, x: number, y: number, rng: () => number, tint: 'purple' | 'teal' | 'warm'): void {
  const [a, b] = tint === 'teal' ? ['#26343d', '#22303a'] : tint === 'warm' ? ['#3d2f33', '#36292d'] : [PAL.wallA, PAL.wallB];
  rect(ctx, x, y, TILE, TILE, a);
  for (let i = 0; i < TILE; i += 4) rect(ctx, x + i, y, 2, TILE, b);
  if (rng() < 0.06) rect(ctx, x + 6, y + 6, 2, 2, PAL.wallTrim);
}

function floorTile(ctx: Ctx, x: number, y: number, rng: () => number): void {
  rect(ctx, x, y, TILE, TILE, (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 ? PAL.floorA : PAL.floorB);
  for (let i = 0; i < TILE; i += 4) rect(ctx, x, y + i, TILE, 1, PAL.floorLine);
  const off = Math.floor(rng() * 12);
  rect(ctx, x + off, y + 1, 1, 3, PAL.floorLine);
  rect(ctx, x + ((off + 7) % 16), y + 5, 1, 3, PAL.floorLine);
  rect(ctx, x + 2, y + 2, 3, 1, PAL.floorShine);
}

function metalFloorTile(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x, y, TILE, TILE, PAL.metalDark);
  rect(ctx, x, y, TILE, 1, PAL.metal);
  rect(ctx, x + 3, y + 4, 1, 1, PAL.metal);
  rect(ctx, x + 11, y + 4, 1, 1, PAL.metal);
  for (let i = 0; i < TILE; i += 4) rect(ctx, x + i, y + 8, 2, 1, PAL.metal);
}

/** Rock around the base (tiled in world space). */
export function drawRockTile(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64);
  const rng = mulberry32(7);
  rect(ctx, 0, 0, 64, 64, PAL.rock);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rng() * 64);
    const y = Math.floor(rng() * 64);
    const w = 1 + Math.floor(rng() * 4);
    rect(ctx, x, y, w, 1 + Math.floor(rng() * 2), rng() < 0.5 ? PAL.rockDark : PAL.rockLight);
  }
  // pebbles
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * 60);
    const y = Math.floor(rng() * 60);
    rect(ctx, x, y, 4, 3, '#4a3e36');
    rect(ctx, x + 1, y, 2, 1, '#5a4c42');
  }
  return canvas;
}

/** Soil band just under the surface. */
export function drawDirtTile(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(32, 32);
  const rng = mulberry32(11);
  rect(ctx, 0, 0, 32, 32, PAL.dirt);
  for (let i = 0; i < 40; i++) rect(ctx, Math.floor(rng() * 32), Math.floor(rng() * 32), 2, 1, rng() < 0.6 ? PAL.dirtDark : '#5a4230');
  return canvas;
}

export function drawGrassTile(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(16, 8);
  rect(ctx, 0, 2, 16, 6, PAL.grass);
  for (let i = 0; i < 16; i += 2) rect(ctx, i, (i * 7) % 3, 1, 3, PAL.grassLight);
  rect(ctx, 0, 7, 16, 1, PAL.dirtDark);
  return canvas;
}

export function drawTree(seed: number): HTMLCanvasElement {
  const rng = mulberry32(seed);
  const h = 40 + Math.floor(rng() * 24);
  const { canvas, ctx } = makeCanvas(36, h);
  const pine = rng() < 0.5;
  rect(ctx, 16, h - 14, 4, 14, '#5a3a26');
  if (pine) {
    for (let i = 0; i < 4; i++) {
      const w = 30 - i * 7;
      rect(ctx, 18 - w / 2, h - 18 - i * 9, w, 9, i % 2 ? '#2f6e3a' : '#357a45');
    }
    rect(ctx, 17, h - 56 < 0 ? 0 : h - 56, 2, 4, '#357a45');
  } else {
    rect(ctx, 4, h - 40, 28, 24, '#357a45');
    rect(ctx, 8, h - 46, 20, 8, '#3f8f4a');
    rect(ctx, 2, h - 32, 32, 12, '#2f6e3a');
    rect(ctx, 10, h - 38, 4, 3, '#5cb85f');
    rect(ctx, 22, h - 30, 3, 3, '#5cb85f');
  }
  return canvas;
}

/** Entrance hut above the elevator shaft. */
export function drawHut(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(96, 64);
  // roof
  for (let i = 0; i < 14; i++) rect(ctx, 6 + i * 3, 14 - i, Math.max(2, 84 - i * 6), 1, i % 2 ? '#6a3a2a' : '#7a4a32');
  rect(ctx, 4, 14, 88, 4, '#5a2f22');
  // walls
  rect(ctx, 10, 18, 76, 46, '#8a6a4a');
  for (let y = 20; y < 64; y += 6) rect(ctx, 10, y, 76, 1, '#6a5038');
  // door (elevator)
  rect(ctx, 36, 34, 24, 30, PAL.metalDark);
  rect(ctx, 47, 34, 2, 30, PAL.metal);
  rect(ctx, 34, 32, 28, 2, PAL.metal);
  // windows
  rect(ctx, 16, 30, 12, 10, '#ffd479');
  rect(ctx, 68, 30, 12, 10, '#ffd479');
  rect(ctx, 21, 30, 2, 10, '#6a5038');
  rect(ctx, 73, 30, 2, 10, '#6a5038');
  // sign board
  rect(ctx, 22, 20, 52, 9, PAL.outline);
  return canvas;
}

// ───────────── props ─────────────

function plant(ctx: Ctx, x: number, floorY: number, big = false): void {
  const h = big ? 22 : 14;
  rect(ctx, x + 2, floorY - 7, 10, 7, PAL.plantPot);
  rect(ctx, x + 1, floorY - 8, 12, 2, '#c97a52');
  rect(ctx, x + 6, floorY - h, 2, h - 7, PAL.leafDark);
  rect(ctx, x + 1, floorY - h + 2, 6, 4, PAL.leaf);
  rect(ctx, x + 7, floorY - h + 5, 6, 4, PAL.leaf);
  rect(ctx, x + 3, floorY - h - 2, 4, 3, PAL.leafDark);
  if (big) {
    rect(ctx, x, floorY - 14, 5, 3, PAL.leafDark);
    rect(ctx, x + 9, floorY - 18, 5, 3, PAL.leaf);
  }
}

function desk(ctx: Ctx, x: number, floorY: number, w: number): void {
  const top = floorY - 22;
  rect(ctx, x, top, w, 4, PAL.deskTop);
  rect(ctx, x, top + 4, w, 2, PAL.deskSide);
  rect(ctx, x + 2, top + 6, 3, 16, PAL.deskLeg);
  rect(ctx, x + w - 5, top + 6, 3, 16, PAL.deskLeg);
  rect(ctx, x + w - 22, top + 6, 17, 9, PAL.deskSide);
  rect(ctx, x + w - 15, top + 10, 4, 1, PAL.gold);
  // coffee mug
  rect(ctx, x + 4, top - 4, 4, 4, '#e8e6d8');
  rect(ctx, x + 8, top - 3, 1, 2, '#e8e6d8');
}

function monitor(ctx: Ctx, x: number, deskTop: number): void {
  rect(ctx, x, deskTop - 18, 26, 16, PAL.monitor);
  rect(ctx, x + 2, deskTop - 16, 22, 11, PAL.screen);
  rect(ctx, x + 11, deskTop - 2, 4, 2, PAL.monitor);
}

function wallShelf(ctx: Ctx, x: number, y: number, w: number, rng: () => number): void {
  rect(ctx, x, y + 12, w, 3, PAL.shelf);
  rect(ctx, x + 2, y + 15, 2, 3, PAL.deskLeg);
  rect(ctx, x + w - 4, y + 15, 2, 3, PAL.deskLeg);
  const colors = [PAL.book1, PAL.book2, PAL.book3, PAL.book4];
  let bx = x + 2;
  while (bx < x + w - 4) {
    const bw = 2 + Math.floor(rng() * 3);
    const bh = 7 + Math.floor(rng() * 5);
    rect(ctx, bx, y + 12 - bh, bw, bh, colors[Math.floor(rng() * colors.length)] as string);
    bx += bw + (rng() < 0.2 ? 2 : 0);
  }
}

function terminalRack(ctx: Ctx, x: number, floorY: number): void {
  rect(ctx, x, floorY - 44, 26, 44, PAL.rackA);
  rect(ctx, x + 1, floorY - 43, 24, 2, PAL.rackB);
  rect(ctx, x + 3, floorY - 38, 20, 14, '#101a12');
  rect(ctx, x + 5, floorY - 35, 8, 1, '#7ee08f');
  rect(ctx, x + 5, floorY - 32, 12, 1, '#4f9a5c');
  rect(ctx, x + 5, floorY - 29, 6, 1, '#7ee08f');
  for (let i = 0; i < 3; i++) rect(ctx, x + 3, floorY - 20 + i * 6, 20, 4, PAL.rackB);
  rect(ctx, x + 19, floorY - 19, 2, 1, PAL.led1);
  rect(ctx, x + 19, floorY - 13, 2, 1, PAL.led2);
}

function poster(ctx: Ctx, x: number, y: number): void {
  // "Explore the depths" poster: a ringed planet over a starry sky
  rect(ctx, x, y, 18, 22, '#e8e0cc');
  rect(ctx, x + 1, y + 1, 16, 20, '#1b2340');
  rect(ctx, x + 3, y + 3, 1, 1, '#f4e9c1');
  rect(ctx, x + 13, y + 5, 1, 1, '#f4e9c1');
  rect(ctx, x + 11, y + 2, 1, 1, '#f4e9c1');
  rect(ctx, x + 6, y + 6, 6, 6, '#9b7ad6');
  rect(ctx, x + 5, y + 7, 8, 4, '#9b7ad6');
  rect(ctx, x + 7, y + 7, 2, 2, '#c4a8f0');
  rect(ctx, x + 3, y + 9, 12, 1, PAL.gold);
  rect(ctx, x + 4, y + 17, 10, 1, PAL.gold);
  rect(ctx, x + 6, y + 15, 6, 1, '#a99fb8');
}

function clock(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x + 1, y, 8, 10, '#e8e0cc');
  rect(ctx, x, y + 1, 10, 8, '#e8e0cc');
  rect(ctx, x + 4, y + 2, 1, 3, PAL.outline);
  rect(ctx, x + 5, y + 5, 2, 1, PAL.outline);
}

function pipes(ctx: Ctx, w: number): void {
  rect(ctx, 0, 6, w, 3, PAL.pipeDark);
  rect(ctx, 0, 6, w, 1, PAL.pipe);
  for (let x = 24; x < w; x += 48) rect(ctx, x, 5, 3, 5, PAL.metal);
}

function hangingLamp(ctx: Ctx, x: number, top: number): void {
  rect(ctx, x + 4, top, 1, 8, PAL.lampMetal);
  rect(ctx, x, top + 8, 9, 3, PAL.lampMetal);
  rect(ctx, x + 2, top + 11, 5, 2, PAL.bulb);
  ctx.fillStyle = 'rgba(255, 231, 163, 0.05)';
  for (let i = 0; i < 30; i++) ctx.fillRect(x + 4 - i, top + 13 + i * 2, 1 + i * 2, 2);
}

function rug(ctx: Ctx, x: number, floorY: number, w: number): void {
  rect(ctx, x, floorY + 2, w, 5, PAL.rug);
  rect(ctx, x, floorY + 2, w, 1, PAL.rugEdge);
  for (let i = x + 2; i < x + w - 2; i += 4) rect(ctx, i, floorY + 4, 2, 1, PAL.rugEdge);
}

function couch(ctx: Ctx, x: number, floorY: number): void {
  rect(ctx, x, floorY - 14, 40, 8, '#6a4a8a');
  rect(ctx, x, floorY - 20, 40, 7, '#5a3d78');
  rect(ctx, x - 3, floorY - 16, 5, 12, '#5a3d78');
  rect(ctx, x + 38, floorY - 16, 5, 12, '#5a3d78');
  rect(ctx, x + 2, floorY - 6, 3, 6, PAL.deskLeg);
  rect(ctx, x + 35, floorY - 6, 3, 6, PAL.deskLeg);
}

function podium(ctx: Ctx, x: number, floorY: number, w: number): void {
  rect(ctx, x, floorY - 8, w, 8, '#4b3d5e');
  rect(ctx, x, floorY - 8, w, 2, PAL.gold);
  rect(ctx, x + Math.floor(w / 2) - 3, floorY - 5, 6, 3, PAL.gold);
}

function door(ctx: Ctx, x: number, floorY: number): void {
  rect(ctx, x, floorY - 40, 18, 40, PAL.metalDark);
  rect(ctx, x + 1, floorY - 39, 16, 38, '#3a3646');
  rect(ctx, x + 8, floorY - 39, 1, 38, PAL.metalDark);
  rect(ctx, x + 3, floorY - 46, 12, 4, '#1f3a2a');
  rect(ctx, x + 5, floorY - 45, 8, 2, '#7ee08f');
}

// ───────────── rooms ─────────────

export type AgentRoomKind = 'main' | 'agent' | 'compact' | 'chief';
export type FillerKind = 'servers' | 'storage' | 'garden' | 'generator' | 'kitchen';
export type RoomKind = AgentRoomKind | `filler-${FillerKind}`;

export interface Stations {
  /** x where the mascot stands for each activity (bottom-center anchor). */
  read: number;
  desk: number;
  bash: number;
  board: number;
  rest: number;
  door: number;
}

export interface RoomGeometry {
  w: number;
  h: number;
  floorY: number;
  mascotScale: number;
  stations: Stations;
  plaque: { x: number; y: number; w: number; h: number };
  board: { x: number; y: number; w: number; h: number } | null;
  /** Screen area on the desk monitor (animated). */
  screen: { x: number; y: number; w: number; h: number } | null;
  lamp: { x: number; y: number };
  footer: { x: number; y: number };
}

export const ROOM_WIDTH: Record<AgentRoomKind, number> = { main: 352, chief: 352, agent: 288, compact: 160 };

export function roomGeometry(kind: RoomKind, width?: number): RoomGeometry {
  const floorY = FLOOR_Y;
  switch (kind) {
    case 'main':
      return {
        w: 352, h: ROOM_H, floorY, mascotScale: 2,
        stations: { read: 36, desk: 96, bash: 158, board: 186, rest: 96, door: 12 },
        plaque: { x: 8, y: 12, w: 186, h: 24 },
        board: { x: 196, y: 38, w: 148, h: 46 },
        screen: { x: 86, y: floorY - 38, w: 22, h: 11 },
        lamp: { x: 336, y: 14 },
        footer: { x: 8, y: 113 },
      };
    case 'chief':
      return {
        w: 352, h: ROOM_H, floorY, mascotScale: 3,
        stations: { read: 60, desk: 60, bash: 60, board: 60, rest: 60, door: 12 },
        plaque: { x: 8, y: 12, w: 220, h: 24 },
        board: { x: 128, y: 42, w: 216, h: 54 },
        screen: null,
        lamp: { x: 336, y: 14 },
        footer: { x: 8, y: 113 },
      };
    case 'compact':
      return {
        w: 160, h: ROOM_H, floorY, mascotScale: 2,
        stations: { read: 36, desk: 36, bash: 36, board: 36, rest: 36, door: 8 },
        plaque: { x: 4, y: 12, w: 152, h: 14 },
        board: null,
        screen: { x: 26, y: floorY - 38, w: 18, h: 9 },
        lamp: { x: 146, y: 30 },
        footer: { x: 62, y: 46 },
      };
    case 'agent':
      return {
        w: 288, h: ROOM_H, floorY, mascotScale: 2,
        stations: { read: 30, desk: 80, bash: 137, board: 152, rest: 80, door: 10 },
        plaque: { x: 6, y: 12, w: 150, h: 24 },
        board: { x: 160, y: 32, w: 122, h: 50 },
        screen: { x: 70, y: floorY - 38, w: 22, h: 11 },
        lamp: { x: 272, y: 14 },
        footer: { x: 6, y: 113 },
      };
    default: {
      const w = width ?? 160;
      return {
        w, h: ROOM_H, floorY, mascotScale: 2,
        stations: { read: 20, desk: 20, bash: 20, board: 20, rest: 20, door: 8 },
        plaque: { x: 4, y: 12, w: w - 8, h: 14 },
        board: null,
        screen: null,
        lamp: { x: w - 14, y: 14 },
        footer: { x: 6, y: 113 },
      };
    }
  }
}

function roomShell(ctx: Ctx, w: number, rng: () => number, tint: 'purple' | 'teal' | 'warm', metal = false): void {
  for (let y = 0; y < FLOOR_Y; y += TILE) for (let x = 0; x < w; x += TILE) wallTile(ctx, x, y, rng, tint);
  rect(ctx, 0, 0, w, 4, PAL.ceiling);
  pipes(ctx, w);
  rect(ctx, 0, FLOOR_Y - 3, w, 3, PAL.baseboard);
  for (let y = FLOOR_Y; y < ROOM_H; y += TILE) for (let x = 0; x < w; x += TILE) (metal ? metalFloorTile(ctx, x, y) : floorTile(ctx, x, y, rng));
  rect(ctx, 0, FLOOR_Y, w, 1, metal ? PAL.metal : PAL.floorShine);
}

function plaqueFrame(ctx: Ctx, g: RoomGeometry): void {
  rect(ctx, g.plaque.x - 1, g.plaque.y - 1, g.plaque.w + 2, g.plaque.h + 2, PAL.plaqueRim);
  rect(ctx, g.plaque.x, g.plaque.y, g.plaque.w, g.plaque.h, PAL.plaque);
}

function boardFrame(ctx: Ctx, g: RoomGeometry): void {
  if (!g.board) return;
  const b = g.board;
  rect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, PAL.boardFrame);
  rect(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, '#5a3d26');
  rect(ctx, b.x, b.y, b.w, b.h, PAL.board);
  rect(ctx, b.x + b.w - 14, b.y + b.h, 10, 2, '#e8e6d8');
}

function outline(ctx: Ctx, w: number, h: number): void {
  ctx.strokeStyle = PAL.outline;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

/** Static room background — cached per kind + seed. */
export function drawRoom(kind: RoomKind, seedKey: string, width?: number): HTMLCanvasElement {
  const g = roomGeometry(kind, width);
  const { canvas, ctx } = makeCanvas(g.w, g.h);
  const rng = mulberry32(hashString(`${kind}:${seedKey}`));
  const F = g.floorY;

  if (kind === 'main') {
    roomShell(ctx, g.w, rng, 'warm');
    wallShelf(ctx, 8, 40, 60, rng);
    wallShelf(ctx, 8, 64, 48, rng);
    hangingLamp(ctx, 120, 4);
    poster(ctx, 128, 44);
    clock(ctx, 166, 46);
    rug(ctx, 50, F, 120);
    desk(ctx, 62, F, 70);
    monitor(ctx, 84, F - 22);
    terminalRack(ctx, 146, F);
    plant(ctx, 178, F, true);
    door(ctx, 330, F);
  } else if (kind === 'chief') {
    roomShell(ctx, g.w, rng, 'purple', true);
    hangingLamp(ctx, 56, 4);
    rug(ctx, 16, F, 92);
    podium(ctx, 34, F, 54);
    plant(ctx, 4, F, true);
    plant(ctx, 100, F);
  } else if (kind === 'compact') {
    roomShell(ctx, g.w, rng, 'purple');
    desk(ctx, 10, F, 52);
    monitor(ctx, 22, F - 22);
    plant(ctx, 142, F);
  } else if (kind === 'agent') {
    roomShell(ctx, g.w, rng, rng() < 0.5 ? 'purple' : 'teal');
    wallShelf(ctx, 6, 44, 52, rng);
    hangingLamp(ctx, 76, 4);
    rug(ctx, 40, F, 76);
    desk(ctx, 48, F, 66);
    monitor(ctx, 68, F - 22);
    terminalRack(ctx, 124, F);
    if (rng() < 0.6) plant(ctx, 6, F);
  } else {
    drawFiller(ctx, kind.slice(7) as FillerKind, g, rng);
  }
  plaqueFrame(ctx, g);
  boardFrame(ctx, g);
  outline(ctx, g.w, g.h);
  return canvas;
}

function drawFiller(ctx: Ctx, kind: FillerKind, g: RoomGeometry, rng: () => number): void {
  const F = g.floorY;
  const w = g.w;
  switch (kind) {
    case 'servers': {
      roomShell(ctx, w, rng, 'teal', true);
      for (let x = 10; x + 26 < w - 6; x += 32) {
        rect(ctx, x, F - 70, 26, 70, PAL.rackA);
        for (let y = F - 66; y < F - 4; y += 8) {
          rect(ctx, x + 2, y, 22, 6, PAL.rackB);
          rect(ctx, x + 18, y + 2, 2, 1, rng() < 0.5 ? PAL.led1 : PAL.led2);
          if (rng() < 0.3) rect(ctx, x + 14, y + 2, 2, 1, PAL.led3);
        }
      }
      break;
    }
    case 'storage': {
      roomShell(ctx, w, rng, 'warm');
      for (let x = 8; x + 22 < w - 4; x += 26 + Math.floor(rng() * 8)) {
        const stack = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < stack; i++) {
          const y = F - 20 * (i + 1);
          rect(ctx, x, y, 22, 20, PAL.crate);
          rect(ctx, x, y, 22, 2, PAL.crateDark);
          rect(ctx, x + 10, y, 2, 20, PAL.crateDark);
          rect(ctx, x + 2, y + 9, 18, 2, PAL.crateDark);
        }
      }
      rect(ctx, w - 24, F - 18, 14, 18, '#5a6b4a');
      rect(ctx, w - 24, F - 14, 14, 2, '#3a4a2a');
      break;
    }
    case 'garden': {
      roomShell(ctx, w, rng, 'teal');
      for (let x = 8; x + 30 < w; x += 36) {
        rect(ctx, x, F - 12, 30, 12, '#5a4030');
        rect(ctx, x, F - 12, 30, 2, '#6a4a36');
        for (let i = 0; i < 4; i++) {
          const px = x + 3 + i * 7;
          const ph = 10 + Math.floor(rng() * 14);
          rect(ctx, px + 2, F - 12 - ph, 1, ph, PAL.leafDark);
          rect(ctx, px, F - 14 - ph, 5, 4, rng() < 0.5 ? PAL.leaf : '#7ad47f');
        }
        rect(ctx, x + 2, 22, 26, 3, '#c58cff');
        ctx.fillStyle = 'rgba(197, 140, 255, 0.07)';
        ctx.fillRect(x, 25, 30, F - 37);
      }
      break;
    }
    case 'generator': {
      roomShell(ctx, w, rng, 'purple', true);
      const gx = Math.floor(w / 2) - 30;
      rect(ctx, gx, F - 48, 60, 48, PAL.metalDark);
      rect(ctx, gx + 4, F - 44, 52, 20, PAL.metal);
      rect(ctx, gx + 10, F - 40, 12, 12, '#1d1a24');
      rect(ctx, gx + 13, F - 37, 6, 6, PAL.gold);
      rect(ctx, gx + 30, F - 38, 20, 2, PAL.led1);
      rect(ctx, gx + 30, F - 33, 14, 2, PAL.led2);
      rect(ctx, gx - 20, 9, 6, F - 57, PAL.pipeDark);
      rect(ctx, gx - 20, F - 48, 20, 6, PAL.pipeDark);
      rect(ctx, gx + 60, F - 30, w - gx - 64 > 0 ? w - gx - 64 : 0, 5, PAL.pipeDark);
      break;
    }
    case 'kitchen': {
      roomShell(ctx, w, rng, 'warm');
      rect(ctx, 8, F - 26, w - 16 > 60 ? 60 : w - 16, 26, '#7a5034');
      rect(ctx, 8, F - 28, w - 16 > 60 ? 60 : w - 16, 3, '#9a6a44');
      rect(ctx, 14, F - 44, 14, 16, PAL.metalDark);
      rect(ctx, 17, F - 40, 8, 6, '#1d1a24');
      rect(ctx, 20, F - 32, 2, 2, '#ffd479');
      rect(ctx, 36, F - 34, 5, 6, '#e8e6d8');
      rect(ctx, 46, F - 34, 5, 6, '#e8e6d8');
      if (w > 120) {
        rect(ctx, w - 48, F - 18, 36, 3, PAL.deskTop);
        rect(ctx, w - 44, F - 15, 2, 15, PAL.deskLeg);
        rect(ctx, w - 18, F - 15, 2, 15, PAL.deskLeg);
      }
      break;
    }
  }
}

// ───────────── small animated props ─────────────

export function drawKeyboard(frame: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(22, 6);
  rect(ctx, 0, 1, 22, 5, '#2a2433');
  rect(ctx, 0, 0, 22, 1, '#4b3d5e');
  for (let i = 0; i < 9; i++) rect(ctx, 1 + i * 2 + (i > 4 ? 1 : 0), 2, 1, 1, (i + frame) % 3 === 0 ? '#ffe7a3' : '#a99fb8');
  for (let i = 0; i < 8; i++) rect(ctx, 2 + i * 2, 4, 1, 1, '#a99fb8');
  return canvas;
}

export function drawScroll(frame: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(16, 12);
  rect(ctx, 1, 1, 14, 10, '#efe2c0');
  rect(ctx, 0, 0, 16, 2, '#c9a25a');
  rect(ctx, 0, 10, 16, 2, '#c9a25a');
  for (let i = 0; i < 3; i++) rect(ctx, 3, 3 + i * 2, 8 + ((i + frame) % 3), 1, '#8a6a4a');
  return canvas;
}

export function drawBubble(frame: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(20, 16);
  rect(ctx, 3, 0, 15, 10, '#ece6f2');
  rect(ctx, 2, 1, 17, 8, '#ece6f2');
  rect(ctx, 4, 11, 3, 2, '#ece6f2');
  rect(ctx, 1, 14, 2, 2, '#ece6f2');
  for (let i = 0; i < 3; i++) rect(ctx, 6 + i * 4, 4, 2, 2, i <= frame % 3 ? '#3b2f4a' : '#c4b8d4');
  return canvas;
}

export function drawQuestion(frame: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(14, 18);
  const c = frame % 2 ? '#f2c14e' : '#ffd479';
  rect(ctx, 1, 0, 12, 13, c);
  rect(ctx, 0, 1, 14, 11, c);
  rect(ctx, 4, 15, 3, 3, c);
  rect(ctx, 5, 2, 4, 1, '#3b2f4a');
  rect(ctx, 9, 3, 1, 3, '#3b2f4a');
  rect(ctx, 7, 6, 2, 1, '#3b2f4a');
  rect(ctx, 6, 7, 1, 2, '#3b2f4a');
  rect(ctx, 6, 10, 1, 1, '#3b2f4a');
  return canvas;
}

export function drawZzz(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(7, 7);
  rect(ctx, 0, 0, 6, 1, '#b9a8d6');
  for (let i = 0; i < 5; i++) rect(ctx, 5 - i, 1 + i, 1, 1, '#b9a8d6');
  rect(ctx, 0, 6, 6, 1, '#b9a8d6');
  return canvas;
}

export function drawSparkle(frame: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(5, 5);
  const c = frame % 2 ? '#ffffff' : '#ffe7a3';
  rect(ctx, 2, 0, 1, 5, c);
  rect(ctx, 0, 2, 5, 1, c);
  return canvas;
}

export function drawStatusLamp(color: string, on: boolean): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(9, 12);
  rect(ctx, 4, 0, 1, 3, PAL.lampMetal);
  rect(ctx, 1, 3, 7, 2, PAL.lampMetal);
  rect(ctx, 2, 5, 5, 5, on ? color : '#3a3248');
  rect(ctx, 3, 6, 2, 1, on ? '#ffffff' : '#4b3d5e');
  rect(ctx, 3, 10, 3, 1, PAL.lampMetal);
  return canvas;
}

export function drawElevatorCab(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(36, 44);
  rect(ctx, 0, 0, 36, 44, PAL.metalDark);
  rect(ctx, 2, 2, 32, 40, '#2a2633');
  rect(ctx, 2, 2, 32, 3, PAL.metal);
  rect(ctx, 16, 6, 4, 2, '#ffd479');
  rect(ctx, 4, 40, 28, 2, PAL.metal);
  rect(ctx, 17, -0, 2, 2, PAL.metal);
  return canvas;
}
