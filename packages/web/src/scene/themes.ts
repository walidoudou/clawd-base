/**
 * Room looks per field of work (domain.ts decides which one). Each theme repaints the walls, floor
 * and rug, swaps the shelves / poster / rack / plant for objects of its field, and animates the desk
 * screen and one object of the room. Everything is drawn in code, like tiles.ts.
 */
import type { Graphics } from 'pixi.js';
import type { Domain } from '@dash/shared';
import { PAL, plant, rect, type RoomTheme } from './tiles.ts';

type Ctx = CanvasRenderingContext2D;
type Screen = { x: number; y: number; w: number; h: number };

/** Animated parts: the desk screen while working, and one object of the room (at the bash station). */
export interface ThemeFx {
  screen(g: Graphics, sc: Screen, f: number): void;
  /** `x` = left of the big object at the bash station, `floorY` its base. */
  ambient(g: Graphics, x: number, floorY: number, f: number, active: boolean): void;
}

// ───────────── small shared shapes ─────────────

function frame(ctx: Ctx, x: number, y: number, w: number, h: number, rim: string, inside: string): void {
  rect(ctx, x, y, w, h, rim);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, inside);
}

function shelf(ctx: Ctx, x: number, y: number, w: number): void {
  rect(ctx, x, y, w, 3, PAL.shelf);
  rect(ctx, x + 2, y + 3, 2, 3, PAL.deskLeg);
  rect(ctx, x + w - 4, y + 3, 2, 3, PAL.deskLeg);
}

function stand(ctx: Ctx, x: number, floorY: number, h: number, c = PAL.metalDark): void {
  rect(ctx, x, floorY - h, 2, h, c);
  rect(ctx, x - 4, floorY - 2, 10, 2, c);
}

// ───────────── themes ─────────────

const game: RoomTheme = {
  wall: ['#1e1d3a', '#1a1934'],
  floor: ['#2b2a4a', '#24233f', '#1a1934', '#3a3960'],
  rug: ['#3a1f5a', '#a05cff'],
  wallDecor(ctx, x, y, w) {
    // cartridges on a shelf, a pixel heart bar and a mounted controller
    shelf(ctx, x, y + 14, w - 20);
    const carts = ['#d77757', '#6cc4ff', '#7ee08f', '#f2c14e', '#a05cff'];
    carts.forEach((c, i) => {
      rect(ctx, x + 3 + i * 7, y + 4, 6, 10, '#3a3960');
      rect(ctx, x + 4 + i * 7, y + 6, 4, 4, c);
    });
    for (let i = 0; i < 3; i++) {
      const hx = x + 2 + i * 8;
      rect(ctx, hx, y + 22, 2, 2, '#ff5c7a');
      rect(ctx, hx + 3, y + 22, 2, 2, '#ff5c7a');
      rect(ctx, hx, y + 24, 5, 2, '#ff5c7a');
      rect(ctx, hx + 1, y + 26, 3, 1, '#ff5c7a');
    }
    const cx = x + w - 18;
    rect(ctx, cx, y + 4, 16, 9, '#2f2e4a');
    rect(ctx, cx + 1, y + 5, 14, 7, '#4a4870');
    rect(ctx, cx + 3, y + 7, 3, 1, '#e8e6d8');
    rect(ctx, cx + 4, y + 6, 1, 3, '#e8e6d8');
    rect(ctx, cx + 11, y + 6, 2, 2, '#ff5c7a');
    rect(ctx, cx + 9, y + 8, 2, 2, '#6cc4ff');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#14132a');
    // space invader
    const px = [
      '..X...X..',
      '...X.X...',
      '..XXXXX..',
      '.XX.X.XX.',
      'XXXXXXXXX',
      'X.XXXXX.X',
      'X.X...X.X',
      '...X.X...',
    ];
    px.forEach((row, r) => [...row].forEach((ch, c) => ch === 'X' && rect(ctx, x + 4 + c, y + 4 + r, 1, 1, '#7ee08f')));
    rect(ctx, x + 3, y + 16, 12, 1, '#a05cff');
    rect(ctx, x + 5, y + 18, 8, 1, '#a05cff');
  },
  deskProp(ctx, x, top) {
    // gamepad
    rect(ctx, x + 1, top - 5, 12, 5, '#2f2e4a');
    rect(ctx, x, top - 4, 14, 3, '#2f2e4a');
    rect(ctx, x + 3, top - 4, 1, 3, '#e8e6d8');
    rect(ctx, x + 2, top - 3, 3, 1, '#e8e6d8');
    rect(ctx, x + 10, top - 4, 1, 1, '#ff5c7a');
    rect(ctx, x + 11, top - 3, 1, 1, '#6cc4ff');
  },
  side(ctx, x, F) {
    // arcade cabinet (screen animated)
    rect(ctx, x, F - 44, 26, 44, '#3a1f5a');
    rect(ctx, x + 2, F - 44, 22, 4, '#a05cff');
    rect(ctx, x + 3, F - 38, 20, 14, '#0b0a18');
    rect(ctx, x, F - 22, 26, 6, '#4a2a72');
    rect(ctx, x + 6, F - 21, 2, 3, '#e8e6d8');
    rect(ctx, x + 5, F - 22, 4, 1, '#ff5c7a');
    rect(ctx, x + 15, F - 20, 2, 2, '#f2c14e');
    rect(ctx, x + 19, F - 20, 2, 2, '#6cc4ff');
    rect(ctx, x + 4, F - 14, 18, 12, '#2a1544');
    rect(ctx, x + 10, F - 10, 6, 2, '#f2c14e');
  },
  corner(ctx, x, F) {
    // retro console + cartridge stack
    rect(ctx, x, F - 6, 14, 6, '#4a4870');
    rect(ctx, x + 1, F - 5, 5, 1, '#ff5c7a');
    rect(ctx, x + 2, F - 12, 10, 6, '#3a3960');
    rect(ctx, x + 3, F - 11, 8, 2, '#6cc4ff');
    rect(ctx, x + 4, F - 16, 6, 4, '#7ee08f');
  },
};

const marketing: RoomTheme = {
  wall: ['#2f3a3a', '#2a3434'],
  floor: ['#8a6a4a', '#7d5f42', '#5e4632', '#9a7a58'],
  rug: ['#a8443a', '#d0644f'],
  wallDecor(ctx, x, y, w) {
    // cork board with sticky notes and a rising chart
    frame(ctx, x, y, w - 4, 28, '#7a5034', '#c49a64');
    const notes = ['#f2c14e', '#ff9ab0', '#7ee08f', '#6cc4ff', '#f2c14e'];
    notes.forEach((c, i) => {
      rect(ctx, x + 3 + i * 8, y + 3 + (i % 2) * 3, 7, 7, c);
      rect(ctx, x + 4 + i * 8, y + 5 + (i % 2) * 3, 5, 1, '#5e4632');
    });
    const cx = x + 4;
    rect(ctx, cx, y + 15, w - 14, 10, '#f4f1ea');
    const pts = [8, 7, 7, 5, 4, 4, 2, 1];
    pts.forEach((h, i) => rect(ctx, cx + 2 + i * Math.floor((w - 18) / pts.length), y + 15 + h, 2, 2, '#d0644f'));
    rect(ctx, cx + w - 18, y + 15, 3, 1, '#7ee08f');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#d0644f');
    rect(ctx, x + 4, y + 4, 3, 3, '#f4f1ea');
    rect(ctx, x + 11, y + 11, 3, 3, '#f4f1ea');
    for (let i = 0; i < 9; i++) rect(ctx, x + 12 - i, y + 4 + i, 2, 1, '#f4f1ea');
    rect(ctx, x + 3, y + 17, 12, 2, '#f2c14e');
  },
  deskProp(ctx, x, top) {
    // megaphone
    rect(ctx, x + 2, top - 5, 4, 3, '#e8e6d8');
    rect(ctx, x + 6, top - 6, 2, 5, '#d0644f');
    rect(ctx, x + 8, top - 7, 2, 7, '#d0644f');
    rect(ctx, x + 10, top - 8, 2, 9, '#a8443a');
    rect(ctx, x + 3, top - 2, 2, 2, '#5e4632');
  },
  side(ctx, x, F) {
    // billboard on a stand (bulbs animated)
    stand(ctx, x + 12, F, 18);
    frame(ctx, x, F - 44, 26, 26, '#2a2233', '#f4f1ea');
    rect(ctx, x + 3, F - 40, 20, 6, '#d0644f');
    rect(ctx, x + 5, F - 38, 16, 2, '#f4f1ea');
    rect(ctx, x + 4, F - 31, 5, 8, '#f2c14e');
    rect(ctx, x + 11, F - 28, 5, 5, '#6cc4ff');
    rect(ctx, x + 18, F - 33, 4, 10, '#7ee08f');
  },
  corner(ctx, x, F) {
    // trophy
    rect(ctx, x + 3, F - 4, 8, 4, '#5e4632');
    rect(ctx, x + 6, F - 8, 2, 4, PAL.gold);
    rect(ctx, x + 3, F - 15, 8, 7, PAL.gold);
    rect(ctx, x + 1, F - 14, 2, 3, PAL.gold);
    rect(ctx, x + 11, F - 14, 2, 3, PAL.gold);
    rect(ctx, x + 5, F - 13, 2, 3, '#ffe7a3');
  },
};

const business: RoomTheme = {
  wall: ['#2b2f3d', '#272a37'],
  floor: ['#4a3a2e', '#43342a', '#30251d', '#5a4838'],
  rug: ['#1f4a3a', '#2f6a52'],
  wallDecor(ctx, x, y, w) {
    // framed stock chart and binders
    frame(ctx, x, y, 34, 22, PAL.gold, '#101a14');
    const c = [12, 10, 13, 8, 9, 5, 6, 3];
    c.forEach((h, i) => {
      rect(ctx, x + 3 + i * 4, y + h, 2, 5, i % 3 === 2 ? '#ff6b6b' : '#7ee08f');
      rect(ctx, x + 3 + i * 4, y + h - 2, 1, 9, '#4a6a54');
    });
    shelf(ctx, x + 36, y + 24, w - 40);
    ['#1f4a7a', '#7a1f2f', '#1f4a7a', '#2f6a52'].forEach((col, i) => {
      rect(ctx, x + 38 + i * 5, y + 10, 4, 14, col);
      rect(ctx, x + 39 + i * 5, y + 13, 2, 3, '#e8e6d8');
    });
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, PAL.gold, '#14202a');
    [4, 7, 10, 14].forEach((h, i) => rect(ctx, x + 3 + i * 3, y + 19 - h, 2, h, '#7ee08f'));
    rect(ctx, x + 3, y + 3, 6, 1, '#e8e6d8');
  },
  deskProp(ctx, x, top) {
    // calculator
    rect(ctx, x + 2, top - 9, 10, 9, '#2a2a35');
    rect(ctx, x + 3, top - 8, 8, 2, '#9fd7a8');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) rect(ctx, x + 3 + c * 3, top - 5 + r * 2, 2, 1, c === 2 && r === 1 ? '#f2c14e' : '#a99fb8');
  },
  side(ctx, x, F) {
    // safe with a ticker on top (ticker animated)
    rect(ctx, x + 1, F - 30, 24, 30, '#4a4658');
    rect(ctx, x + 3, F - 28, 20, 24, '#5a5468');
    rect(ctx, x + 10, F - 20, 6, 6, '#2a2233');
    rect(ctx, x + 12, F - 18, 2, 2, PAL.gold);
    rect(ctx, x + 19, F - 18, 2, 6, '#2a2233');
    rect(ctx, x, F - 44, 26, 12, '#101a14');
    rect(ctx, x, F - 33, 26, 1, '#2a2233');
  },
  corner(ctx, x, F) {
    // money plant
    rect(ctx, x + 2, F - 7, 10, 7, '#2f4a3a');
    rect(ctx, x + 6, F - 18, 2, 11, '#357a45');
    rect(ctx, x + 1, F - 16, 5, 4, '#7ee08f');
    rect(ctx, x + 8, F - 19, 5, 4, '#7ee08f');
    rect(ctx, x + 3, F - 14, 1, 1, PAL.gold);
    rect(ctx, x + 10, F - 17, 1, 1, PAL.gold);
  },
};

const video: RoomTheme = {
  wall: ['#1c1c1f', '#18181b'],
  floor: ['#2a2a2e', '#252529', '#1a1a1d', '#3a3a40'],
  rug: ['#5a1f1f', '#8a2f2f'],
  wallDecor(ctx, x, y, w) {
    // film strip across the wall and a clapper
    rect(ctx, x, y + 2, w - 4, 12, '#0b0b0d');
    for (let i = 0; i < w - 6; i += 5) {
      rect(ctx, x + i + 1, y + 3, 3, 2, '#e8e6d8');
      rect(ctx, x + i + 1, y + 11, 3, 2, '#e8e6d8');
    }
    for (let i = 0; i < 4; i++) rect(ctx, x + 2 + i * 14, y + 6, 11, 4, ['#6cc4ff', '#f2c14e', '#d77757', '#7ee08f'][i] as string);
    const cx = x + 4;
    rect(ctx, cx, y + 20, 18, 9, '#222226');
    for (let i = 0; i < 4; i++) rect(ctx, cx + i * 5, y + 17, 3, 3, i % 2 ? '#e8e6d8' : '#222226');
    rect(ctx, cx, y + 17, 18, 1, '#e8e6d8');
    rect(ctx, cx + 2, y + 23, 10, 1, '#e8e6d8');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#2a0f14');
    rect(ctx, x + 8, y + 4, 2, 2, PAL.gold);
    rect(ctx, x + 6, y + 6, 6, 2, PAL.gold);
    rect(ctx, x + 7, y + 8, 4, 2, PAL.gold);
    rect(ctx, x + 6, y + 10, 2, 2, PAL.gold);
    rect(ctx, x + 10, y + 10, 2, 2, PAL.gold);
    rect(ctx, x + 3, y + 15, 12, 1, '#e8e0cc');
    rect(ctx, x + 5, y + 17, 8, 1, '#e8e0cc');
  },
  deskProp(ctx, x, top) {
    // film reel
    rect(ctx, x + 3, top - 10, 9, 9, '#5a5468');
    rect(ctx, x + 2, top - 8, 11, 5, '#5a5468');
    rect(ctx, x + 6, top - 7, 3, 3, '#1c1c1f');
    rect(ctx, x + 4, top - 9, 2, 2, '#1c1c1f');
    rect(ctx, x + 9, top - 4, 2, 2, '#1c1c1f');
  },
  side(ctx, x, F) {
    // camera on a tripod (REC light animated)
    rect(ctx, x + 12, F - 24, 2, 22, '#5a5468');
    rect(ctx, x + 4, F - 4, 2, 4, '#5a5468');
    rect(ctx, x + 20, F - 4, 2, 4, '#5a5468');
    rect(ctx, x + 6, F - 6, 14, 2, '#5a5468');
    rect(ctx, x + 3, F - 38, 18, 13, '#2a2a30');
    rect(ctx, x + 21, F - 35, 5, 7, '#3a3a42');
    rect(ctx, x + 22, F - 34, 3, 5, '#6cc4ff');
    rect(ctx, x + 5, F - 44, 6, 6, '#2a2a30');
    rect(ctx, x + 12, F - 44, 6, 6, '#2a2a30');
    rect(ctx, x + 7, F - 42, 2, 2, '#5a5468');
    rect(ctx, x + 14, F - 42, 2, 2, '#5a5468');
  },
  corner(ctx, x, F) {
    // spotlight on a stand
    stand(ctx, x + 6, F, 16);
    rect(ctx, x + 2, F - 24, 10, 8, '#3a3a42');
    rect(ctx, x + 10, F - 23, 3, 6, '#ffe7a3');
  },
};

const design: RoomTheme = {
  wall: ['#3d3442', '#38303d'],
  floor: ['#c9b79c', '#bfae93', '#a8977c', '#d8c8ae'],
  rug: ['#3f6ab0', '#f2c14e'],
  wallDecor(ctx, x, y, w) {
    // colour swatches and a framed abstract artwork
    const sw = ['#ff5c7a', '#f2c14e', '#7ee08f', '#6cc4ff', '#a05cff', '#d77757'];
    sw.forEach((c, i) => {
      rect(ctx, x + (i % 3) * 8, y + Math.floor(i / 3) * 10 + 2, 7, 8, '#f4f1ea');
      rect(ctx, x + 1 + (i % 3) * 8, y + Math.floor(i / 3) * 10 + 3, 5, 4, c);
    });
    const ax = x + 28;
    frame(ctx, ax, y, w - 32, 26, '#7a5034', '#f4f1ea');
    rect(ctx, ax + 3, y + 4, 8, 8, '#ff5c7a');
    rect(ctx, ax + 9, y + 10, 10, 10, '#6cc4ff');
    rect(ctx, ax + 15, y + 4, 4, 4, '#f2c14e');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#2a2233', '#f4f1ea');
    rect(ctx, x + 4, y + 4, 10, 10, '#a05cff');
    rect(ctx, x + 7, y + 7, 4, 4, '#f4f1ea');
    rect(ctx, x + 3, y + 17, 4, 2, '#ff5c7a');
    rect(ctx, x + 8, y + 17, 4, 2, '#6cc4ff');
  },
  deskProp(ctx, x, top) {
    // tablet + stylus
    rect(ctx, x + 1, top - 3, 12, 3, '#2a2233');
    rect(ctx, x + 2, top - 2, 10, 1, '#6cc4ff');
    rect(ctx, x + 9, top - 9, 1, 6, '#f2c14e');
    rect(ctx, x + 9, top - 10, 1, 1, '#2a2233');
  },
  side(ctx, x, F) {
    // easel with a canvas (stroke animated)
    rect(ctx, x + 4, F - 20, 2, 20, '#7a5034');
    rect(ctx, x + 20, F - 20, 2, 20, '#7a5034');
    rect(ctx, x + 12, F - 44, 2, 44, '#7a5034');
    rect(ctx, x + 2, F - 20, 22, 2, '#7a5034');
    frame(ctx, x + 2, F - 42, 22, 22, '#e8e0cc', '#f4f1ea');
  },
  corner(ctx, x, F) {
    // paint bucket with brushes
    rect(ctx, x + 2, F - 9, 10, 9, '#6cc4ff');
    rect(ctx, x + 2, F - 9, 10, 2, '#a05cff');
    rect(ctx, x + 4, F - 15, 1, 6, '#7a5034');
    rect(ctx, x + 8, F - 16, 1, 7, '#7a5034');
    rect(ctx, x + 3, F - 17, 3, 2, '#ff5c7a');
    rect(ctx, x + 7, F - 18, 3, 2, '#f2c14e');
  },
};

const audio: RoomTheme = {
  wall: ['#2a2238', '#251e32'],
  floor: ['#3a2c2a', '#342725', '#241a19', '#4a3a36'],
  rug: ['#2f2f5a', '#5a5aa8'],
  wallDecor(ctx, x, y, w) {
    // acoustic foam and a vinyl record
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        rect(ctx, x + c * 9, y + r * 9, 8, 8, (r + c) % 2 ? '#3a2f52' : '#33294a');
        rect(ctx, x + c * 9 + 2, y + r * 9 + 2, 4, 1, '#463a64');
      }
    const vx = x + w - 22;
    rect(ctx, vx + 2, y + 2, 16, 20, '#111111');
    rect(ctx, vx, y + 5, 20, 14, '#111111');
    rect(ctx, vx + 7, y + 9, 6, 6, '#d77757');
    rect(ctx, vx + 9, y + 11, 2, 2, '#111111');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#1a1430');
    [5, 9, 13, 8, 11, 6].forEach((h, i) => rect(ctx, x + 3 + i * 2, y + 18 - h, 1, h, i % 2 ? '#a05cff' : '#6cc4ff'));
  },
  deskProp(ctx, x, top) {
    // microphone on a desk stand
    rect(ctx, x + 4, top - 2, 7, 2, '#3a3a42');
    rect(ctx, x + 7, top - 7, 1, 5, '#5a5468');
    rect(ctx, x + 5, top - 12, 5, 6, '#a99fb8');
    rect(ctx, x + 6, top - 11, 3, 1, '#5a5468');
    rect(ctx, x + 6, top - 9, 3, 1, '#5a5468');
  },
  side(ctx, x, F) {
    // speaker tower (woofer animated) with an ON AIR sign on top
    rect(ctx, x + 2, F - 34, 22, 34, '#1f1a2a');
    rect(ctx, x + 9, F - 31, 8, 8, '#3a3346');
    rect(ctx, x + 11, F - 29, 4, 4, '#111111');
    rect(ctx, x + 6, F - 20, 14, 14, '#3a3346');
    rect(ctx, x, F - 44, 26, 8, '#3a1414');
  },
  corner(ctx, x, F) {
    // guitar on a stand
    rect(ctx, x + 6, F - 26, 2, 12, '#5e4632');
    rect(ctx, x + 5, F - 28, 4, 3, '#2a2233');
    rect(ctx, x + 2, F - 14, 10, 8, '#d77757');
    rect(ctx, x + 3, F - 18, 8, 5, '#d77757');
    rect(ctx, x + 6, F - 12, 2, 2, '#2a2233');
    rect(ctx, x + 3, F - 2, 8, 2, PAL.metalDark);
  },
};

const bot: RoomTheme = {
  wall: ['#262b3d', '#222737'],
  floor: ['#2e3348', '#292e42', '#1f2333', '#3d4360'],
  rug: ['#3a42a0', '#5865f2'],
  wallDecor(ctx, x, y, w) {
    // a big chat bubble sign with a slash command, and channel list
    rect(ctx, x, y + 2, 34, 18, '#5865f2');
    rect(ctx, x + 4, y + 20, 5, 4, '#5865f2');
    rect(ctx, x + 4, y + 7, 2, 8, '#f4f1ea');
    rect(ctx, x + 6, y + 5, 2, 2, '#f4f1ea');
    rect(ctx, x + 10, y + 10, 3, 3, '#f4f1ea');
    rect(ctx, x + 16, y + 10, 3, 3, '#f4f1ea');
    rect(ctx, x + 22, y + 10, 3, 3, '#f4f1ea');
    const lx = x + 38;
    for (let i = 0; i < 4; i++) {
      rect(ctx, lx, y + 3 + i * 6, 2, 2, '#8e95b8');
      rect(ctx, lx + 3, y + 3 + i * 6, Math.max(6, w - 46 - i * 2), 2, i === 1 ? '#f4f1ea' : '#8e95b8');
    }
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#2e3348');
    rect(ctx, x + 4, y + 5, 10, 9, '#a99fb8');
    rect(ctx, x + 8, y + 3, 2, 2, '#a99fb8');
    rect(ctx, x + 6, y + 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 10, y + 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 6, y + 12, 6, 1, '#2e3348');
    rect(ctx, x + 5, y + 16, 8, 3, '#5865f2');
  },
  deskProp(ctx, x, top) {
    // small robot figure
    rect(ctx, x + 4, top - 10, 7, 6, '#a99fb8');
    rect(ctx, x + 5, top - 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 8, top - 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 7, top - 12, 1, 2, '#ff6b6b');
    rect(ctx, x + 5, top - 4, 5, 4, '#8e95b8');
  },
  side(ctx, x, F) {
    // bot server with a big chat logo (notification animated)
    rect(ctx, x, F - 44, 26, 44, '#1f2333');
    rect(ctx, x + 1, F - 43, 24, 2, '#3d4360');
    rect(ctx, x + 4, F - 38, 18, 12, '#5865f2');
    rect(ctx, x + 7, F - 26, 3, 3, '#5865f2');
    rect(ctx, x + 8, F - 34, 2, 2, '#f4f1ea');
    rect(ctx, x + 12, F - 34, 2, 2, '#f4f1ea');
    rect(ctx, x + 16, F - 34, 2, 2, '#f4f1ea');
    for (let i = 0; i < 3; i++) rect(ctx, x + 3, F - 18 + i * 5, 20, 3, '#2e3348');
  },
  corner(ctx, x, F) {
    // little robot pet
    rect(ctx, x + 2, F - 10, 10, 8, '#8e95b8');
    rect(ctx, x + 4, F - 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 8, F - 8, 2, 2, '#6cc4ff');
    rect(ctx, x + 6, F - 13, 2, 3, '#a99fb8');
    rect(ctx, x + 3, F - 2, 3, 2, '#3d4360');
    rect(ctx, x + 8, F - 2, 3, 2, '#3d4360');
  },
};

const data: RoomTheme = {
  wall: ['#1f2a33', '#1b252e'],
  floor: ['#2c3a44', '#27343d', '#1c262d', '#3a4c58'],
  rug: ['#1f5a5a', '#2fa0a0'],
  wallDecor(ctx, x, y, w) {
    // whiteboard with a formula and a scatter plot
    frame(ctx, x, y, w - 4, 28, '#8a8fa0', '#eef2f4');
    rect(ctx, x + 3, y + 4, 12, 1, '#3a4c58');
    rect(ctx, x + 3, y + 7, 8, 1, '#3a4c58');
    rect(ctx, x + 13, y + 7, 3, 1, '#d77757');
    rect(ctx, x + 3, y + 10, 14, 1, '#3a4c58');
    const px = x + 22;
    rect(ctx, px, y + 4, 1, 20, '#3a4c58');
    rect(ctx, px, y + 23, w - 30, 1, '#3a4c58');
    for (let i = 0; i < 9; i++) rect(ctx, px + 3 + i * 3, y + 20 - i * 2 + ((i * 7) % 3), 2, 2, i % 2 ? '#2fa0a0' : '#d77757');
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#14202a');
    const n: Array<[number, number]> = [[4, 6], [4, 14], [9, 4], [9, 10], [9, 16], [14, 10]];
    for (const [a, b] of n) rect(ctx, x + a, y + b, 2, 2, '#2fa0a0');
    rect(ctx, x + 5, y + 8, 4, 1, '#3a6a70');
    rect(ctx, x + 10, y + 12, 4, 1, '#3a6a70');
  },
  deskProp(ctx, x, top) {
    // stack of printed charts
    rect(ctx, x + 2, top - 3, 11, 3, '#e8e6d8');
    rect(ctx, x + 3, top - 6, 10, 3, '#f4f1ea');
    rect(ctx, x + 4, top - 10, 9, 4, '#f4f1ea');
    rect(ctx, x + 5, top - 8, 2, 2, '#2fa0a0');
    rect(ctx, x + 8, top - 9, 2, 3, '#d77757');
  },
  side(ctx, x, F) {
    // GPU tower (fans animated)
    rect(ctx, x + 1, F - 44, 24, 44, '#1b252e');
    rect(ctx, x + 2, F - 43, 22, 2, '#3a4c58');
    rect(ctx, x + 5, F - 38, 16, 14, '#27343d');
    rect(ctx, x + 5, F - 21, 16, 14, '#27343d');
    rect(ctx, x + 3, F - 5, 20, 2, '#2fa0a0');
  },
  corner(ctx, x, F) {
    // coffee machine (data runs on coffee)
    rect(ctx, x + 2, F - 18, 10, 18, '#3a3a42');
    rect(ctx, x + 3, F - 16, 8, 4, '#1b252e');
    rect(ctx, x + 5, F - 7, 4, 4, '#e8e6d8');
    rect(ctx, x + 9, F - 15, 1, 1, '#7ee08f');
  },
};

const devops: RoomTheme = {
  wall: ['#2a2e2a', '#252925'],
  floor: ['#3a3e44', '#34383d', '#26292d', '#4a4f56'],
  rug: ['#5a4a1f', '#c9a23a'],
  wallDecor(ctx, x, y, w) {
    // cable tray and a status panel
    rect(ctx, x, y + 2, w - 4, 4, PAL.metal);
    for (let i = 0; i < w - 6; i += 6) rect(ctx, x + i, y + 6, 1, 2, PAL.metalDark);
    ['#d77757', '#6cc4ff', '#7ee08f'].forEach((c, i) => rect(ctx, x + 4 + i * 3, y + 6, 2, 10 + i * 4, c));
    const px = x + 22;
    frame(ctx, px, y + 8, w - 28, 20, '#1a1d20', '#0f1a12');
    for (let r = 0; r < 3; r++) {
      rect(ctx, px + 3, y + 12 + r * 5, 2, 2, r === 2 ? '#f2c14e' : '#7ee08f');
      rect(ctx, px + 7, y + 12 + r * 5, w - 40, 2, '#2f4a3a');
    }
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#c9a23a');
    for (let i = 0; i < 18; i += 4) rect(ctx, x + 1, y + 1 + i, 16, 2, '#1a1d20');
    rect(ctx, x + 6, y + 6, 6, 8, '#c9a23a');
    rect(ctx, x + 8, y + 7, 2, 4, '#1a1d20');
    rect(ctx, x + 8, y + 12, 2, 1, '#1a1d20');
  },
  deskProp(ctx, x, top) {
    // wrench and a hard drive
    rect(ctx, x + 1, top - 3, 8, 3, '#5a5468');
    rect(ctx, x + 2, top - 2, 2, 1, '#7ee08f');
    rect(ctx, x + 9, top - 9, 2, 9, PAL.metal);
    rect(ctx, x + 8, top - 11, 4, 3, PAL.metal);
    rect(ctx, x + 9, top - 11, 2, 1, '#252925');
  },
  side(ctx, x, F) {
    // tall server rack (LEDs animated)
    rect(ctx, x, F - 44, 26, 44, '#1a1d20');
    rect(ctx, x + 1, F - 43, 24, 1, '#3a3e44');
    for (let i = 0; i < 6; i++) {
      rect(ctx, x + 2, F - 41 + i * 7, 22, 5, '#2a2e33');
      rect(ctx, x + 3, F - 39 + i * 7, 12, 1, '#3a3e44');
    }
  },
  corner(ctx, x, F) {
    // traffic cone
    rect(ctx, x + 1, F - 2, 12, 2, '#c95a2a');
    rect(ctx, x + 3, F - 6, 8, 4, '#e8742f');
    rect(ctx, x + 4, F - 10, 6, 4, '#f4f1ea');
    rect(ctx, x + 5, F - 15, 4, 5, '#e8742f');
  },
};

const security: RoomTheme = {
  wall: ['#151a1c', '#121618'],
  floor: ['#1f2628', '#1b2123', '#121618', '#2c3638'],
  rug: ['#1f3a2a', '#3fbf6a'],
  wallDecor(ctx, x, y, w) {
    // CCTV monitor grid
    const cw = Math.floor((w - 8) / 2);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) {
        const mx = x + c * (cw + 2);
        const my = y + r * 14;
        frame(ctx, mx, my, cw, 12, '#2c3638', '#0b1a10');
        rect(ctx, mx + 2, my + 8, cw - 4, 1, '#1f5a34');
        rect(ctx, mx + 3 + ((r + c) * 5) % (cw - 8), my + 4, 3, 4, '#3fbf6a');
      }
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#0b1a10');
    rect(ctx, x + 4, y + 4, 10, 10, '#3fbf6a');
    rect(ctx, x + 5, y + 14, 8, 2, '#3fbf6a');
    rect(ctx, x + 7, y + 16, 4, 2, '#3fbf6a');
    rect(ctx, x + 7, y + 7, 4, 5, '#0b1a10');
    rect(ctx, x + 8, y + 5, 2, 2, '#0b1a10');
  },
  deskProp(ctx, x, top) {
    // padlock
    rect(ctx, x + 4, top - 7, 7, 7, PAL.gold);
    rect(ctx, x + 5, top - 11, 1, 4, '#a99fb8');
    rect(ctx, x + 9, top - 11, 1, 4, '#a99fb8');
    rect(ctx, x + 5, top - 12, 5, 1, '#a99fb8');
    rect(ctx, x + 7, top - 5, 1, 2, '#2a2233');
  },
  side(ctx, x, F) {
    // vault door (lock LED animated)
    rect(ctx, x, F - 44, 26, 44, '#2c3638');
    rect(ctx, x + 2, F - 42, 22, 40, '#3a4648');
    rect(ctx, x + 6, F - 30, 14, 14, '#2c3638');
    rect(ctx, x + 12, F - 28, 2, 10, '#5a6668');
    rect(ctx, x + 8, F - 24, 10, 2, '#5a6668');
    rect(ctx, x + 4, F - 40, 2, 36, '#2c3638');
  },
  corner(ctx, x, F) {
    // paper shredder
    rect(ctx, x + 1, F - 12, 12, 12, '#2c3638');
    rect(ctx, x + 2, F - 14, 10, 2, '#5a6668');
    for (let i = 0; i < 4; i++) rect(ctx, x + 3 + i * 2, F - 18 + (i % 2), 1, 4, '#e8e6d8');
  },
};

const web: RoomTheme = {
  wall: ['#2a3040', '#262b3a'],
  floor: ['#5a4a6a', '#52435f', '#3e324a', '#6a5a7d'],
  rug: ['#2f6aa0', '#6cc4ff'],
  wallDecor(ctx, x, y, w) {
    // two browser windows with wireframes
    const bw = Math.floor((w - 8) / 2);
    for (let i = 0; i < 2; i++) {
      const bx = x + i * (bw + 3);
      const by = y + i * 4;
      frame(ctx, bx, by, bw, 24, '#8e95b8', '#f4f1ea');
      rect(ctx, bx + 1, by + 1, bw - 2, 3, '#8e95b8');
      rect(ctx, bx + 2, by + 2, 1, 1, '#ff6b6b');
      rect(ctx, bx + 4, by + 2, 1, 1, '#f2c14e');
      rect(ctx, bx + 3, by + 6, bw - 6, 4, '#6cc4ff');
      rect(ctx, bx + 3, by + 12, 8, 8, '#d8dce8');
      rect(ctx, bx + 13, by + 12, bw - 16, 2, '#a99fb8');
      rect(ctx, bx + 13, by + 16, bw - 18, 2, '#a99fb8');
    }
  },
  poster(ctx, x, y) {
    frame(ctx, x, y, 18, 22, '#e8e0cc', '#262b3a');
    rect(ctx, x + 4, y + 7, 3, 1, '#6cc4ff');
    rect(ctx, x + 3, y + 8, 2, 1, '#6cc4ff');
    rect(ctx, x + 4, y + 9, 3, 1, '#6cc4ff');
    rect(ctx, x + 11, y + 7, 3, 1, '#6cc4ff');
    rect(ctx, x + 13, y + 8, 2, 1, '#6cc4ff');
    rect(ctx, x + 11, y + 9, 3, 1, '#6cc4ff');
    rect(ctx, x + 8, y + 6, 1, 5, '#f2c14e');
    rect(ctx, x + 4, y + 15, 10, 2, '#a99fb8');
  },
  deskProp(ctx, x, top) {
    // phone showing a responsive page
    rect(ctx, x + 4, top - 12, 7, 12, '#2a2233');
    rect(ctx, x + 5, top - 11, 5, 9, '#f4f1ea');
    rect(ctx, x + 5, top - 11, 5, 2, '#6cc4ff');
    rect(ctx, x + 6, top - 8, 3, 1, '#a99fb8');
    rect(ctx, x + 6, top - 6, 3, 1, '#a99fb8');
  },
  side(ctx, x, F) {
    // big monitor on a stand showing a page (spinner animated)
    stand(ctx, x + 12, F, 12);
    frame(ctx, x, F - 44, 26, 32, '#1d1a24', '#f4f1ea');
    rect(ctx, x + 1, F - 43, 24, 4, '#8e95b8');
    rect(ctx, x + 3, F - 37, 20, 5, '#6cc4ff');
  },
  corner(ctx, x, F) {
    plant(ctx, x, F);
  },
};

export const THEMES: Record<Domain, RoomTheme | null> = { code: null, game, marketing, business, video, design, audio, bot, data, devops, security, web };

// ───────────── animations ─────────────

const DEFAULT_SCREEN: ThemeFx['screen'] = (g, sc, f) => {
  for (let i = 0; i < 4; i++) {
    const w = 4 + ((f * 7 + i * 5) % (sc.w - 6));
    g.rect(sc.x + 2, sc.y + 1 + i * 2.5, w, 1).fill(i === 3 ? 0xffe7a3 : 0x6cc4ff);
  }
  g.rect(sc.x, sc.y, sc.w, sc.h).fill({ color: 0x6cc4ff, alpha: 0.06 + 0.05 * (f % 2) });
};

const tri = (f: number, n: number): number => {
  const k = f % (2 * n);
  return k < n ? k : 2 * n - k;
};

export const THEME_FX: Record<Domain, ThemeFx> = {
  code: { screen: DEFAULT_SCREEN, ambient: () => undefined },
  game: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x14132a);
      g.rect(sc.x, sc.y + sc.h - 2, sc.w, 2).fill(0x7ee08f);
      const jump = [0, 2, 3, 3, 2, 0][f % 6] ?? 0;
      g.rect(sc.x + 5, sc.y + sc.h - 5 - jump, 3, 3).fill(0xd77757);
      const cx = sc.x + sc.w - 2 - ((f * 2) % (sc.w - 6));
      g.rect(cx, sc.y + 3, 2, 2).fill(0xf2c14e);
    },
    ambient(g, x, F, f, active) {
      const colors = [0x6cc4ff, 0xa05cff, 0x7ee08f, 0xff5c7a];
      g.rect(x + 3, F - 38, 20, 14).fill({ color: colors[Math.floor(f / 3) % 4] ?? 0x6cc4ff, alpha: active ? 0.55 : 0.2 });
      g.rect(x + 6 + (f % 12), F - 33, 3, 3).fill({ color: 0xf4f1ea, alpha: active ? 1 : 0.4 });
    },
  },
  marketing: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0xf4f1ea);
      for (let i = 0; i < 4; i++) {
        const h = 2 + ((tri(f + i * 2, 6) + i * 2) % (sc.h - 3));
        g.rect(sc.x + 2 + i * 5, sc.y + sc.h - 1 - h, 3, h).fill(i === 3 ? 0xd0644f : 0x6cc4ff);
      }
    },
    ambient(g, x, F, f, active) {
      for (let i = 0; i < 6; i++) {
        const on = active && (i + f) % 2 === 0;
        g.rect(x + 2 + i * 4, F - 45, 2, 1).fill({ color: 0xffe7a3, alpha: on ? 1 : 0.25 });
        g.rect(x + 2 + i * 4, F - 18, 2, 1).fill({ color: 0xffe7a3, alpha: !on && active ? 1 : 0.25 });
      }
    },
  },
  business: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x101a14);
      for (let i = 0; i < 5; i++) {
        const v = (f + i * 3) % 7;
        const up = (i + f) % 3 !== 0;
        g.rect(sc.x + 2 + i * 4, sc.y + 2 + v % (sc.h - 5), 2, 3).fill(up ? 0x7ee08f : 0xff6b6b);
      }
    },
    ambient(g, x, F, f, active) {
      for (let i = 0; i < 8; i++) {
        const k = (i + f) % 8;
        g.rect(x + 2 + i * 3, F - 40 + (k % 3) * 2, 2, 2).fill({ color: k % 3 === 0 ? 0xff6b6b : 0x7ee08f, alpha: active ? 1 : 0.35 });
      }
    },
  },
  video: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x1c1c1f);
      g.rect(sc.x + 1, sc.y + 2, sc.w - 2, 2).fill(0x6cc4ff);
      g.rect(sc.x + 1, sc.y + 5, sc.w - 6, 2).fill(0xf2c14e);
      g.rect(sc.x + 4, sc.y + 8, sc.w - 8, 1).fill(0x7ee08f);
      g.rect(sc.x + 1 + (f % (sc.w - 2)), sc.y, 1, sc.h).fill(0xff3b3b);
    },
    ambient(g, x, F, f, active) {
      g.rect(x + 5, F - 36, 2, 2).fill({ color: 0xff3b3b, alpha: active && f % 4 < 2 ? 1 : 0.25 });
    },
  },
  design: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0xf4f1ea);
      const sw = [0xff5c7a, 0xf2c14e, 0x7ee08f, 0x6cc4ff, 0xa05cff];
      for (let i = 0; i < 4; i++) g.rect(sc.x + 2 + i * 5, sc.y + 2, 4, 3).fill(sw[(i + Math.floor(f / 2)) % 5] ?? 0x6cc4ff);
      g.rect(sc.x + 3 + (f % (sc.w - 8)), sc.y + 7, 4, 2).fill(0x2a2233);
    },
    ambient(g, x, F, f, active) {
      const c = [0xff5c7a, 0x6cc4ff, 0xf2c14e, 0x7ee08f][Math.floor(f / 4) % 4] ?? 0xff5c7a;
      const len = active ? 2 + (f % 14) : 10;
      g.rect(x + 5, F - 34, len, 3).fill(c);
      g.rect(x + 8, F - 28, Math.max(2, len - 4), 2).fill({ color: 0xa05cff, alpha: 0.8 });
    },
  },
  audio: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x1a1430);
      for (let i = 0; i < sc.w - 2; i += 2) {
        const h = 1 + Math.round(Math.abs(Math.sin((i + f * 2) / 3)) * (sc.h - 3));
        g.rect(sc.x + 1 + i, sc.y + (sc.h - h) / 2, 1, h).fill(i % 4 ? 0xa05cff : 0x6cc4ff);
      }
    },
    ambient(g, x, F, f, active) {
      const r = active ? 3 + (f % 3) : 3;
      g.rect(x + 13 - r, F - 13 - r, r * 2, r * 2).fill(0x111111);
      g.rect(x + 12, F - 14, 2, 2).fill(0x5a5468);
      g.rect(x + 3, F - 43, 20, 6).fill({ color: 0xff3b3b, alpha: active ? (f % 6 < 4 ? 0.9 : 0.5) : 0.25 });
    },
  },
  bot: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x2e3348);
      const n = f % 4;
      for (let i = 0; i <= n && i < 3; i++) {
        const right = i % 2 === 1;
        g.rect(right ? sc.x + sc.w - 11 : sc.x + 2, sc.y + 1 + i * 3, 9, 2).fill(right ? 0x5865f2 : 0x8e95b8);
      }
    },
    ambient(g, x, F, f, active) {
      g.rect(x + 19, F - 40, 5, 5).fill({ color: 0xff3b3b, alpha: active && f % 6 < 3 ? 1 : 0.2 });
    },
  },
  data: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x14202a);
      const n = sc.w - 4;
      for (let i = 0; i < n; i += 2) {
        const y = Math.round((sc.h - 4) * Math.exp(-i / 6)) + ((i * 7) % 2);
        g.rect(sc.x + 2 + i, sc.y + 1 + y, 2, 1).fill(0x2fa0a0);
      }
      const k = f % n;
      g.rect(sc.x + 2 + k, sc.y + 1 + Math.round((sc.h - 4) * Math.exp(-k / 6)), 2, 2).fill(0xd77757);
    },
    ambient(g, x, F, f, active) {
      for (const fy of [F - 31, F - 14]) {
        const k = active ? f % 4 : 0;
        if (k % 2 === 0) {
          g.rect(x + 12, fy - 5, 2, 10).fill(0x3a4c58);
          g.rect(x + 8, fy - 1, 10, 2).fill(0x3a4c58);
        } else {
          g.rect(x + 9, fy - 4, 2, 2).fill(0x3a4c58);
          g.rect(x + 15, fy + 2, 2, 2).fill(0x3a4c58);
          g.rect(x + 15, fy - 4, 2, 2).fill(0x3a4c58);
          g.rect(x + 9, fy + 2, 2, 2).fill(0x3a4c58);
        }
        g.rect(x + 12, fy - 1, 2, 2).fill(0x2fa0a0);
      }
    },
  },
  devops: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x0f1a12);
      for (let i = 0; i < 3; i++) {
        const w = Math.min(sc.w - 4, ((f + i * 5) % (sc.w + 6)));
        g.rect(sc.x + 2, sc.y + 1 + i * 3, w, 2).fill(w >= sc.w - 4 ? 0x7ee08f : 0xf2c14e);
      }
    },
    ambient(g, x, F, f, active) {
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 2; j++) {
          const on = active ? (i * 3 + j * 5 + f) % 4 !== 0 : j === 0;
          g.rect(x + 18 + j * 3, F - 40 + i * 7, 2, 1).fill({ color: (i + j) % 3 ? 0x7ee08f : 0x6cc4ff, alpha: on ? 1 : 0.2 });
        }
    },
  },
  security: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0x0b1a10);
      const cx = sc.x + sc.w / 2;
      const cy = sc.y + sc.h / 2;
      const r = Math.min(sc.w, sc.h) / 2 - 1;
      g.circle(cx, cy, r).stroke({ width: 1, color: 0x1f5a34 });
      const a = (f / 8) * Math.PI * 2;
      g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r).stroke({ width: 1, color: 0x3fbf6a });
      if (f % 8 < 3) g.rect(cx + 3, cy - 2, 1, 1).fill(0xff6b6b);
    },
    ambient(g, x, F, f, active) {
      g.rect(x + 18, F - 38, 3, 3).fill(active && f % 6 < 3 ? 0xff3b3b : 0x3fbf6a);
    },
  },
  web: {
    screen(g, sc, f) {
      g.rect(sc.x, sc.y, sc.w, sc.h).fill(0xf4f1ea);
      const k = f % 6;
      g.rect(sc.x + 1, sc.y + 1, sc.w - 2, 2).fill(0x6cc4ff);
      if (k > 0) g.rect(sc.x + 2, sc.y + 4, 6, 4).fill(0xd8dce8);
      if (k > 1) g.rect(sc.x + 10, sc.y + 4, sc.w - 12, 1).fill(0xa99fb8);
      if (k > 2) g.rect(sc.x + 10, sc.y + 6, sc.w - 14, 1).fill(0xa99fb8);
      if (k > 3) g.rect(sc.x + 2, sc.y + sc.h - 2, sc.w - 4, 1).fill(0xf2c14e);
    },
    ambient(g, x, F, f, active) {
      if (!active) return;
      const pts: Array<[number, number]> = [[0, -3], [2, -2], [3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2]];
      pts.forEach(([dx, dy], i) => g.rect(x + 13 + dx, F - 24 + dy, 1, 1).fill({ color: 0x6cc4ff, alpha: ((i - f) % 8 + 8) % 8 < 3 ? 1 : 0.25 }));
    },
  },
};

// ───────────── tools held while editing (replace the keyboard) ─────────────

/** What the mascot holds while it edits, 16 × 10, two frames; null = the default keyboard. */
export function drawTool(domain: Domain, f: number): HTMLCanvasElement | null {
  if (domain === 'code' || domain === 'web') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 10;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  const on = f % 2 === 0;
  switch (domain) {
    case 'game':
      rect(ctx, 2, 3, 12, 5, '#2f2e4a');
      rect(ctx, 1, 4, 14, 3, '#2f2e4a');
      rect(ctx, 4, 4, 1, 3, '#e8e6d8');
      rect(ctx, 3, 5, 3, 1, '#e8e6d8');
      rect(ctx, 11, 4, 1, 1, on ? '#ff5c7a' : '#6a2a3a');
      rect(ctx, 12, 5, 1, 1, on ? '#2a4a6a' : '#6cc4ff');
      break;
    case 'marketing':
      rect(ctx, 1, 4, 4, 3, '#e8e6d8');
      rect(ctx, 5, 3, 2, 5, '#d0644f');
      rect(ctx, 7, 2, 2, 7, '#d0644f');
      rect(ctx, 9, 1, 2, 9, '#a8443a');
      if (on) {
        rect(ctx, 13, 2, 1, 2, '#ffe7a3');
        rect(ctx, 13, 6, 1, 2, '#ffe7a3');
      } else rect(ctx, 14, 4, 1, 2, '#ffe7a3');
      break;
    case 'business':
      rect(ctx, 3, 0, 10, 10, '#2a2a35');
      rect(ctx, 4, 1, 8, 2, '#9fd7a8');
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) rect(ctx, 4 + c * 3, 5 + r * 2, 2, 1, (r * 3 + c + f) % 4 === 0 ? '#f2c14e' : '#a99fb8');
      break;
    case 'video':
      rect(ctx, 2, 4, 12, 6, '#222226');
      rect(ctx, 4, 6, 7, 1, '#e8e6d8');
      if (on) for (let i = 0; i < 4; i++) rect(ctx, 2 + i * 3, 2, 2, 2, i % 2 ? '#e8e6d8' : '#222226');
      else for (let i = 0; i < 4; i++) rect(ctx, 3 + i * 3, 0 + i, 2, 2, i % 2 ? '#e8e6d8' : '#222226');
      break;
    case 'design':
      rect(ctx, 1, 6, 12, 4, '#2a2233');
      rect(ctx, 2, 7, 10, 2, '#6cc4ff');
      rect(ctx, on ? 8 : 5, 1, 1, 6, '#f2c14e');
      rect(ctx, on ? 8 : 5, 0, 1, 1, '#2a2233');
      break;
    case 'audio':
      rect(ctx, 6, 0, 4, 5, '#a99fb8');
      rect(ctx, 7, 5, 2, 5, '#5a5468');
      rect(ctx, 11, on ? 1 : 2, 1, on ? 3 : 1, '#a05cff');
      rect(ctx, 13, on ? 0 : 1, 1, on ? 5 : 3, '#6cc4ff');
      break;
    case 'bot':
      rect(ctx, 1, 1, 14, 7, '#5865f2');
      rect(ctx, 3, 8, 3, 2, '#5865f2');
      for (let i = 0; i < 3; i++) rect(ctx, 4 + i * 3, 4, 2, 2, (i + f) % 3 === 0 ? '#f4f1ea' : '#a9b0f8');
      break;
    case 'data':
      rect(ctx, 1, 1, 14, 9, '#2a2233');
      rect(ctx, 2, 2, 12, 7, '#14202a');
      [3, 5, 4, 6].forEach((h, i) => rect(ctx, 3 + i * 3, 9 - (h + (on ? i % 2 : 0)), 2, h + (on ? i % 2 : 0) - 1, '#2fa0a0'));
      break;
    case 'devops':
      if (on) {
        rect(ctx, 2, 4, 10, 2, PAL.metal);
        rect(ctx, 11, 2, 4, 6, PAL.metal);
        rect(ctx, 13, 4, 2, 2, '#252925');
      } else {
        for (let i = 0; i < 6; i++) rect(ctx, 3 + i, 8 - i, 2, 2, PAL.metal);
        rect(ctx, 9, 0, 5, 4, PAL.metal);
        rect(ctx, 11, 1, 2, 2, '#252925');
      }
      break;
    case 'security':
      rect(ctx, 3, 1, 7, 7, '#a99fb8');
      rect(ctx, 4, 2, 5, 5, '#bfe8f4');
      if (on) rect(ctx, 5, 3, 1, 1, '#ffffff');
      rect(ctx, 9, 7, 2, 2, '#5a5468');
      rect(ctx, 11, 8, 3, 2, '#5a5468');
      break;
  }
  return canvas;
}
