import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { data, isArchived, useDash } from '../state.ts';
import { BaseScene, type FocusRect, type MinimapData } from './Scene.ts';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Minimap: rooms as coloured blocks + the current viewport; click to move the camera. */
function Minimap({ data, onPick }: { data: MinimapData | null; onPick: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 180;
  const H = 120;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !data) return;
    const { bounds: b } = data;
    const s = Math.min(W / Math.max(1, b.w), H / Math.max(1, b.h));
    const ox = (W - b.w * s) / 2;
    const oy = (H - b.h * s) / 2;
    ctx.fillStyle = '#120f17';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a2233';
    ctx.fillRect(0, oy + (0 - b.y) * s, W, H);
    for (const r of data.rooms) {
      ctx.fillStyle = r.color;
      ctx.fillRect(Math.round(ox + (r.x - b.x) * s), Math.round(oy + (r.y - b.y) * s), Math.max(2, Math.round(r.w * s) - 1), Math.max(2, Math.round(r.h * s) - 1));
    }
    const v = data.view;
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ox + (v.x - b.x) * s) + 0.5, Math.round(oy + (v.y - b.y) * s) + 0.5, Math.round(v.w * s), Math.round(v.h * s));
  }, [data]);
  return (
    <canvas
      ref={ref}
      className="minimap"
      width={W}
      height={H}
      aria-label={t.minimap}
      onClick={(e) => {
        if (!data) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const b = data.bounds;
        const s = Math.min(W / Math.max(1, b.w), H / Math.max(1, b.h));
        const ox = (W - b.w * s) / 2;
        const oy = (H - b.h * s) / 2;
        onPick(b.x + (e.clientX - rect.left - ox) / s, b.y + (e.clientY - rect.top - oy) / s);
      }}
    />
  );
}

/** React wrapper around the PixiJS base scene + accessible focus layer + controls. */
export default function GameView() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BaseScene | null>(null);
  const [rects, setRects] = useState<FocusRect[]>([]);
  const [fps, setFps] = useState(60);
  const [minimap, setMinimap] = useState<MinimapData | null>(null);
  const [compact, setCompact] = useState(() => readPref('dash.compact', false));
  const [follow, setFollow] = useState(() => readPref('dash.follow', false));
  const [showMap, setShowMap] = useState(() => readPref('dash.minimap', true));
  const sessionId = useDash((s) => s.sessionId);
  const select = useDash((s) => s.select);
  useDash((s) => s.version);
  const showArchived = useDash((s) => s.showArchived);
  const setShowArchived = useDash((s) => s.setShowArchived);
  const now = Date.now();
  let archivedCount = 0;
  if (sessionId) for (const a of data.agents.values()) if (a.sessionId === sessionId && isArchived(a, now)) archivedCount++;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new BaseScene();
    sceneRef.current = scene;
    scene.onFocusRects = setRects;
    scene.onFps = setFps;
    scene.onMinimap = setMinimap;
    scene.compactForced = readPref('dash.compact', false);
    scene.follow = readPref('dash.follow', false);
    // The demo caption and the side panel cover part of the canvas: the camera frames around them.
    scene.insets = () => {
      const host = el.getBoundingClientRect();
      const out = { top: 8, right: 8, bottom: 8, left: 8 };
      const caption = document.querySelector('.demo-overlay')?.getBoundingClientRect();
      if (caption && caption.height > 0) out.bottom = Math.max(out.bottom, host.bottom - caption.top + 12);
      const panel = document.querySelector('.side-panel')?.getBoundingClientRect();
      if (panel && panel.width > 0 && panel.left < host.right) out.right = Math.max(out.right, host.right - panel.left + 12);
      return out;
    };
    scene.init(el).catch(() => {
      // No WebGL/WebGPU (GPU blocklist, VM…): fall back to the list view instead of a blank canvas.
      const st = useDash.getState();
      st.setView('list');
      st.pushToast({ level: 'warn', text: t.noWebgl, sessionId: st.sessionId ?? '', agentId: null, at: Date.now() });
    });
    let lastNarration = '';
    const unsub = useDash.subscribe((s, prev) => {
      if (s.version !== prev.version) scene.pulse();
      // Guided demo: each caption tells the camera what to frame; leaving the session ends it.
      const n = s.sessionId ? data.sessions.get(s.sessionId)?.narration : null;
      const key = n ? `${s.sessionId}:${n.at}:${n.step}:${n.done}` : '';
      if (key !== lastNarration) {
        lastNarration = key;
        scene.setFocus(n?.focus ?? null, n?.at);
      }
      if (s.showArchived !== prev.showArchived) scene.requestSync();
      if (s.version !== prev.version || s.selection !== prev.selection || s.sessionId !== prev.sessionId || s.config !== prev.config) scene.requestSync();
    });
    return () => {
      unsub();
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.compactForced = compact;
    s.follow = follow;
    s.requestSync();
    writePref('dash.compact', compact);
    writePref('dash.follow', follow);
  }, [compact, follow]);

  useEffect(() => writePref('dash.minimap', showMap), [showMap]);

  return (
    <div className="game-wrap">
      <div ref={host} className="game-canvas-host" />
      <div className="room-focus-layer" aria-label={t.keyboardHint}>
        {rects.map((r) => (
          <button
            key={r.key}
            className="room-focus"
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            aria-label={t.labelled(r.entity === 'workflow' ? t.workflow : t.agent, r.label)}
            onFocus={() => sceneRef.current?.focusRoom(r.key)}
            onClick={() => select({ kind: r.entity, id: r.id })}
          />
        ))}
      </div>
      {!sessionId && (
        <div className="empty" style={{ position: 'absolute', inset: 0 }}>
          {t.noSession}
        </div>
      )}
      <div className="fps" aria-hidden>
        {fps} fps
      </div>
      {showMap && (
        <div className="minimap-wrap">
          <Minimap data={minimap} onPick={(x, y) => sceneRef.current?.centerOn(x, y)} />
        </div>
      )}
      <div className="game-controls">
        <button onClick={() => sceneRef.current?.zoomAt(1)} aria-label={t.zoomIn} title={t.zoomIn}>
          ＋
        </button>
        <button onClick={() => sceneRef.current?.zoomAt(-1)} aria-label={t.zoomOut} title={t.zoomOut}>
          －
        </button>
        <button onClick={() => sceneRef.current?.recenter()}>{t.recenter}</button>
        <button className={follow ? 'on' : ''} aria-pressed={follow} onClick={() => setFollow(!follow)}>
          {t.follow}
        </button>
        <button className={compact ? 'on' : ''} aria-pressed={compact} onClick={() => setCompact(!compact)}>
          {t.compact}
        </button>
        <button className={showMap ? 'on' : ''} aria-pressed={showMap} onClick={() => setShowMap(!showMap)}>
          {t.minimap}
        </button>
        <button className={showArchived ? 'on' : ''} aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)} title={t.archivedTitle} disabled={archivedCount === 0 && !showArchived}>
          {t.archived(archivedCount)}
        </button>
      </div>
    </div>
  );
}
