import { memo, useEffect, useRef } from 'react';
import { composeMascot, generateMascot, getSpriteSet, gridToRgba, type Anim } from '@dash/shared';
import { useDash } from '../state.ts';

/** Small pixel-perfect mascot portrait for panels and lists (integer scaling). */
export const MascotCanvas = memo(function MascotCanvas({
  id,
  chief = false,
  canonical = false,
  anim = 'idle',
  scale = 3,
}: {
  id: string;
  chief?: boolean;
  canonical?: boolean;
  anim?: Anim;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spriteSet = useDash((s) => s.config.spriteSet);
  const set = getSpriteSet(spriteSet);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const look = generateMascot(id, { chief, canonical, ...(set.canonicalColor ? { canonicalColor: set.canonicalColor } : {}) });
    let frame = 0;
    const draw = () => {
      const g = composeMascot(look, anim, frame, set);
      ctx.putImageData(new ImageData(gridToRgba(g) as Uint8ClampedArray<ArrayBuffer>, g.width, g.height), 0, 0);
    };
    draw();
    const timer = window.setInterval(() => {
      frame++;
      draw();
    }, 420);
    return () => window.clearInterval(timer);
  }, [id, chief, canonical, anim, set]);
  return (
    <canvas
      ref={ref}
      width={set.width}
      height={set.height}
      className="mascot-canvas"
      style={{ width: set.width * scale, height: set.height * scale }}
      aria-hidden
    />
  );
});
