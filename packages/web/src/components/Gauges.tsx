import { memo } from 'react';
import { t, intlLocale } from '../i18n/index.ts';
import { formatTokens } from '../format.ts';

/** Context window usage bar (same formula as Claude Code: input + cache of the last request). */
export const ContextGauge = memo(function ContextGauge({ used, window, compactions = 0, wide = false }: { used: number; window: number; compactions?: number; wide?: boolean }) {
  const pct = window > 0 ? Math.min(100, (used / window) * 100) : 0;
  const level = pct > 85 ? 'hot' : pct > 60 ? 'warm' : 'ok';
  return (
    <div className={`ctx-gauge ${wide ? 'wide' : ''}`} title={t.labelled(t.context, `${used.toLocaleString(intlLocale)} / ${window.toLocaleString(intlLocale)} tokens`)}>
      <div className="ctx-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t.context}>
        <span className={`ctx-fill ctx-${level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="ctx-label">
        {t.context} {Math.round(pct)}% · {t.contextOf(formatTokens(used), formatTokens(window))}
        {compactions > 0 ? ` · ${t.compactions(compactions)}` : ''}
      </span>
    </div>
  );
});

/** Tiny tokens-per-minute chart from the session usage timeline. */
export const Sparkline = memo(function Sparkline({ start, buckets, minutes = 30, now }: { start: number; buckets: number[]; minutes?: number; now: number }) {
  const W = 96;
  const H = 22;
  const endMinute = Math.floor(now / 60000) * 60000;
  const values: number[] = [];
  for (let i = minutes - 1; i >= 0; i--) {
    const m = endMinute - i * 60000;
    const idx = Math.round((m - start) / 60000);
    values.push(idx >= 0 && idx < buckets.length ? (buckets[idx] ?? 0) : 0);
  }
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (minutes - 1)) * (W - 2) + 1},${H - 2 - (v / max) * (H - 4)}`).join(' ');
  const last = values[values.length - 2] ?? 0; // last complete minute
  return (
    <span className="sparkline" title={`${t.tokensPerMin} (${minutes} min) — max ${formatTokens(max)}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={`1,${H - 1} ${pts} ${W - 1},${H - 1}`} fill="rgba(108,196,255,0.15)" stroke="none" />
        <polyline points={pts} fill="none" stroke="#6cc4ff" strokeWidth="1" shapeRendering="crispEdges" />
      </svg>
      <span className="spark-value">{formatTokens(last)}/min</span>
    </span>
  );
});
