export const ANIMATIONS = ['idle', 'walk', 'type', 'read', 'think', 'celebrate', 'sleep', 'error'] as const;
export type Anim = (typeof ANIMATIONS)[number];

/** Semantic palette roles resolved per mascot; any other value is a literal hex color. */
export type PaletteRole = 'body' | 'bodyShade' | 'bodyLight' | 'leg' | 'eye' | 'eyeLight' | 'accessory' | 'accessoryShade' | 'gold' | 'white' | 'black' | 'blush' | 'gem';

export interface SpriteSet {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Reference points used to place accessories, so a replacement sprite can reuse them. */
  anchors: {
    /** y of the first body row (accessories are placed relative to it). */
    headTop: number;
    /** x of the horizontal center. */
    centerX: number;
    eyeRow: number;
    handLeft: { x: number; y: number };
    handRight: { x: number; y: number };
  };
  /** Body colour of the main-session mascot (the "canonical" character). */
  canonicalColor?: string;
  /** Grid character → palette role or literal hex color. '.' is always transparent. */
  palette: Record<string, PaletteRole | string>;
  /** Each animation has ≥1 frame; each frame is `height` strings of `width` chars. */
  frames: Record<Anim, string[][]>;
}
