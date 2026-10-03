import { useEffect, useRef, useState } from 'react';
import { locale, t } from '../i18n/index.ts';
import { data, useDash } from '../state.ts';
import { MascotCanvas } from './MascotCanvas.tsx';

async function post(path: string, body: unknown = {}): Promise<Response | null> {
  try {
    return await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

/** Start the guided demo and jump to its session. */
export async function startDemo(speed = 1): Promise<void> {
  const r = await post('/api/demo/start', { speed, locale });
  if (!r?.ok) return;
  const { sessionId } = (await r.json()) as { sessionId: string };
  const st = useDash.getState();
  st.select(null);
  st.setView('game');
  st.selectSession(sessionId);
}

/** Typewriter effect: reveals `text` progressively, restarting when it changes (speed changes apply on the fly). */
function useTypewriter(text: string, cps: number): string {
  const [n, setN] = useState(0);
  const rate = useRef(cps);
  rate.current = cps;
  useEffect(() => {
    setN(0);
    let shown = 0;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      shown += ((now - last) / 1000) * rate.current;
      last = now;
      const k = Math.min(text.length, Math.floor(shown));
      setN(k);
      if (k >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [text]);
  return text.slice(0, n);
}

/** Caption panel of the guided demo (bottom centre), with pause / speed / stop. */
export function DemoOverlay() {
  useDash((s) => s.version);
  const sessionId = useDash((s) => s.sessionId);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hidden, setHidden] = useState(false);
  const n = sessionId ? data.sessions.get(sessionId)?.narration : null;
  const typed = useTypewriter(n?.text ?? '', paused ? 0 : 55 * speed);
  useEffect(() => {
    setHidden(false);
  }, [n?.step]);
  // A new tour starts at normal speed.
  useEffect(() => {
    setPaused(false);
    setSpeed(1);
  }, [sessionId]);
  if (!n || hidden) return null;
  const progress = Math.round((n.step / n.total) * 100);
  return (
    <section className="demo-overlay" aria-label={t.demo.title}>
      <p className="sr-only" aria-live="polite">
        {n.title}. {n.text}
      </p>
      <div className="demo-head">
        <MascotCanvas id={sessionId ?? 'demo'} canonical anim={n.done ? 'celebrate' : 'idle'} scale={2} />
        <span className="demo-badge">{t.demo.title}</span>
        <span className="demo-step">
          {t.step} {n.step}/{n.total}
        </span>
        <span className="demo-controls">
          {!n.done && (
            <>
              <button
                onClick={() => {
                  void post('/api/demo/pause', { paused: !paused });
                  setPaused(!paused);
                }}
                aria-pressed={paused}
                title={paused ? t.demo.resume : t.demo.pause}
              >
                {paused ? '▶' : '⏸'}
              </button>
              {[0.5, 1, 2].map((sp) => (
                <button
                  key={sp}
                  className={speed === sp ? 'on' : ''}
                  onClick={() => {
                    void post('/api/demo/speed', { speed: sp });
                    setSpeed(sp);
                  }}
                >
                  ×{sp}
                </button>
              ))}
              <button onClick={() => void post('/api/demo/stop')} title={t.demo.stop}>
                ⏹
              </button>
            </>
          )}
          {n.done && <button onClick={() => void startDemo()}>{t.demo.replay}</button>}
          <button onClick={() => setHidden(true)} aria-label={t.close} title={t.close}>
            ✕
          </button>
        </span>
      </div>
      <div className="demo-progress" aria-hidden>
        <span style={{ width: `${progress}%` }} />
      </div>
      <h2 className="demo-title" aria-hidden>
        {n.title}
      </h2>
      {/* The invisible full text reserves the final height: the box (and the camera framing around it) stays still while typing. */}
      <p className="demo-text" aria-hidden>
        <span className="demo-ghost">{n.text}</span>
        <span className="demo-typed">
          {typed}
          {typed.length < n.text.length && <span className="demo-caret">▌</span>}
        </span>
      </p>
      {paused && <div className="demo-paused">{t.demo.paused}</div>}
    </section>
  );
}
