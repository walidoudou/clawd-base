import { clawd } from './clawd.ts';
import { mole } from './mole.ts';
import type { SpriteSet } from './types.ts';

export * from './types.ts';
export { clawd, mole };

/** Default base character (original). */
export const DEFAULT_SPRITE_SET = 'mole';

/**
 * Registry of base characters. Select one with `spriteSet` in ~/.clawd-base/config.json
 * ("mole" by default, "clawd" for Claude Code's mascot); register a new SpriteSet here to add one.
 */
export const SPRITE_SETS: Record<string, SpriteSet> = { mole, clawd };

export function getSpriteSet(id: string | null | undefined): SpriteSet {
  return (id && SPRITE_SETS[id]) || mole;
}

/** Throws if a sprite set is malformed (used by tests and at registration). */
export function validateSpriteSet(s: SpriteSet): void {
  for (const [anim, frames] of Object.entries(s.frames)) {
    if (!frames.length) throw new Error(`${s.id}.${anim}: no frames`);
    frames.forEach((f, i) => {
      if (f.length !== s.height) throw new Error(`${s.id}.${anim}[${i}]: ${f.length} rows, expected ${s.height}`);
      f.forEach((row, y) => {
        if (row.length !== s.width) throw new Error(`${s.id}.${anim}[${i}] row ${y}: width ${row.length}, expected ${s.width}`);
        for (const ch of row) if (ch !== '.' && !(ch in s.palette)) throw new Error(`${s.id}.${anim}[${i}]: unknown palette key '${ch}'`);
      });
    });
  }
}
