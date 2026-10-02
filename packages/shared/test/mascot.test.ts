import { describe, expect, it } from 'vitest';
import { ACCESSORIES, CHIEF_ACCESSORIES, CLAWD_ORANGE, animationFor, composeMascot, generateMascot, gridToRgba, hashString, mulberry32 } from '../src/mascot.ts';
import { ANIMATIONS, clawd, getSpriteSet, mole, validateSpriteSet } from '../src/sprites/index.ts';

describe('sprite set', () => {
  it('clawd frames are well formed for every animation', () => {
    expect(() => validateSpriteSet(clawd)).not.toThrow();
    for (const a of ANIMATIONS) expect(clawd.frames[a].length).toBeGreaterThan(0);
  });
  it('unknown sprite set ids fall back to the default original mascot', () => {
    expect(getSpriteSet('nope').id).toBe('mole');
    expect(getSpriteSet('clawd').id).toBe('clawd');
  });
  it('the default mole set is well formed and distinct from Clawd', () => {
    expect(() => validateSpriteSet(mole)).not.toThrow();
    expect(mole.frames.idle[0]).not.toEqual(clawd.frames.idle[0]);
    expect(mole.canonicalColor).toBeDefined();
    // same footprint, so accessories line up
    expect([mole.width, mole.height, mole.anchors.headTop, mole.anchors.centerX]).toEqual([clawd.width, clawd.height, clawd.anchors.headTop, clawd.anchors.centerX]);
  });
  it('canonical colour follows the sprite set', () => {
    expect(generateMascot('main', { canonical: true, canonicalColor: mole.canonicalColor as string }).body).toBe(mole.canonicalColor);
    const g = composeMascot(generateMascot('x'), 'idle', 0, mole);
    expect(g.pixels.filter(Boolean).length).toBeGreaterThan(50);
  });
  it('idle frame keeps the Clawd silhouette (two eyes, four legs, side arms)', () => {
    const f = clawd.frames.idle[0] ?? [];
    expect(f.join('').split('E').length - 1).toBe(4); // 2 eyes × 2 px
    expect((f[12] ?? '').replace(/\./g, '')).toBe('LLLL');
    expect(f[8]?.startsWith('.BB')).toBe(true);
  });
});

describe('deterministic mascots', () => {
  it('hash and rng are stable', () => {
    expect(hashString('agent-1')).toBe(hashString('agent-1'));
    expect(hashString('agent-1')).not.toBe(hashString('agent-2'));
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('same id gives the same look and pixels', () => {
    const l1 = generateMascot('a1b2c3d4e5f6a7b8c');
    const l2 = generateMascot('a1b2c3d4e5f6a7b8c');
    expect(l1).toEqual(l2);
    expect(composeMascot(l1, 'type', 1)).toEqual(composeMascot(l2, 'type', 1));
  });
  it('different ids give varied looks', () => {
    const looks = Array.from({ length: 60 }, (_, i) => generateMascot(`agent-${i}`));
    expect(new Set(looks.map((l) => l.body)).size).toBeGreaterThan(40);
    expect(new Set(looks.map((l) => l.accessory)).size).toBeGreaterThan(5);
    for (const l of looks) expect(ACCESSORIES).toContain(l.accessory);
  });
  it('workflow chiefs always wear a crown or chef hat', () => {
    for (let i = 0; i < 30; i++) expect(CHIEF_ACCESSORIES).toContain(generateMascot(`wf-${i}`, { chief: true }).accessory);
  });
  it('canonical mascot is the original Clawd orange', () => {
    expect(generateMascot('session', { canonical: true }).body).toBe(CLAWD_ORANGE);
  });
  it('composes RGBA with transparent background', () => {
    const g = composeMascot(generateMascot('x'), 'idle', 0);
    const rgba = gridToRgba(g);
    expect(rgba.length).toBe(g.width * g.height * 4);
    expect(rgba[3]).toBe(0);
  });
});

describe('animation mapping', () => {
  const now = 10_000;
  it('maps tools and states to animations', () => {
    expect(animationFor({ status: 'running', currentTool: 'Read' }, now, null)).toBe('read');
    expect(animationFor({ status: 'running', currentTool: 'Edit' }, now, null)).toBe('type');
    expect(animationFor({ status: 'running', currentTool: null }, now, null)).toBe('think');
    expect(animationFor({ status: 'error', currentTool: null }, now, null)).toBe('error');
    expect(animationFor({ status: 'done', currentTool: null }, now, now - 1000)).toBe('celebrate');
    expect(animationFor({ status: 'done', currentTool: null }, now, now - 60_000)).toBe('sleep');
  });
});
