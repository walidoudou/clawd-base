import { useEffect, useState } from 'react';
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

/** Typewriter effect: reveals `text` progressively, restarting when it changes. */
function useTypewriter(text: string, cps = 55): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const start = performance.now();
    const id = window.setInterval(() => {
      const k = Math.floor(((performance.now() - start) / 1000) * cps);
      setN(Math.min(text.length, k));
      if (k >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [text, cps]);
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
  const typed = useTypewriter(n?.text ?? '');
  useEffect(() => {
    setHidden(false);
  }, [n?.step]);
  if (!n || hidden) return null;
  const progress = Math.round((n.step / n.total) * 100);
  return (
    <section className="demo-overlay" aria-live="polite" aria-label={t.demo.title}>
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
      <h2 className="demo-title">{n.title}</h2>
      <p className="demo-text">
        {typed}
        {typed.length < n.text.length && <span className="demo-caret">▌</span>}
      </p>
      {paused && <div className="demo-paused">{t.demo.paused}</div>}
    </section>
  );
}
