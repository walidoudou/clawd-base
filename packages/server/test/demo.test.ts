import { describe, expect, it } from 'vitest';
import { StateStore, hookToEvents } from '@dash/shared';
import { DEMO_STEPS, DemoAborted, DemoRunner, readingTime, runGuidedDemo, type DemoTransport } from '../src/demo.ts';

/** In-process transport; with `speed`, timestamps follow a virtual clock running that much faster. */
function inProcess(store: StateStore, speed = 1): DemoTransport {
  const t0 = Date.now();
  const clock = () => t0 + (Date.now() - t0) * speed;
  return {
    hook: async (p) => store.applyAll(hookToEvents(p, clock())),
    events: async (evs) => store.applyAll(evs.map((e) => ({ ...e, at: clock() }))),
  };
}

describe('guided demo', () => {
  it('plays the whole story A to Z', async () => {
    const store = new StateStore();
    const id = await runGuidedDemo(inProcess(store, 400), { speed: 400, paused: false, aborted: false });
    store.flush();
    const s = store.sessions.get(id);
    expect(s).toMatchObject({ status: 'ended', title: 'Démo guidée — refonte du paiement' });
    expect(s?.narration).toMatchObject({ step: DEMO_STEPS, total: DEMO_STEPS, done: true });
    expect(s?.tasks).toEqual([expect.objectContaining({ status: 'completed' })]);
    const agents = [...store.agents.values()].filter((a) => a.sessionId === id);
    const main = agents.find((a) => a.kind === 'main');
    expect(main?.compactions).toBe(1);
    expect(main?.todos.every((t) => t.status === 'completed')).toBe(true);
    expect(main?.liveText).toContain('Tout est prêt');
    expect(main?.errorCount).toBeGreaterThanOrEqual(1);
    const subs = agents.filter((a) => a.kind === 'sub');
    expect(subs.length).toBe(14); // 3 + 2 + 1 nested + 1 reviewer + 1 crash + 4 + 2
    expect(subs.some((a) => a.status === 'error')).toBe(true);
    // nested: an agent launched by a sub-agent
    expect(subs.some((a) => subs.some((p) => p.id === a.parentId))).toBe(true);
    const wfs = [...store.workflows.values()].filter((w) => w.sessionId === id);
    expect(wfs.map((w) => w.source).sort()).toEqual(['heuristic', 'marker']);
    expect(wfs.find((w) => w.source === 'heuristic')?.steps).toHaveLength(3);
    expect(wfs.find((w) => w.source === 'marker')?.name).toBe('audit-sécurité');
    // Edits happened (their diffs are computed by Ingest, covered in server.test.ts).
    expect([...store.tools.values()].filter((t) => t.sessionId === id && t.name === 'Edit').length).toBeGreaterThan(5);
    expect([...store.files.values()].some((f) => f.sessionId === id && f.operation === 'read')).toBe(true);
  });

  it('speaks English when asked', async () => {
    const store = new StateStore();
    const id = await runGuidedDemo(inProcess(store, 400), { speed: 400, paused: false, aborted: false }, undefined, 'en');
    store.flush();
    expect(store.sessions.get(id)).toMatchObject({ title: 'Guided demo — payment refactor', narration: expect.objectContaining({ title: 'End of the demo', done: true }) });
    expect([...store.workflows.values()].some((w) => w.sessionId === id && w.name === 'security-audit')).toBe(true);
  });

  it('leaves every caption up long enough to be read', async () => {
    const store = new StateStore();
    const base = inProcess(store, 400);
    const captions: Array<{ step: number; text: string; at: number; focus: unknown }> = [];
    const t0 = Date.now();
    const transport: DemoTransport = {
      hook: base.hook,
      events: async (evs) => {
        // demo time ≈ real time × speed
        for (const e of evs) if (e.kind === 'narration') captions.push({ step: e.narration.step, text: e.narration.text, at: (Date.now() - t0) * 400, focus: e.narration.focus });
        return base.events(evs);
      },
    };
    await runGuidedDemo(transport, { speed: 400, paused: false, aborted: false });
    expect(captions.map((c) => c.step)).toEqual([...Array.from({ length: DEMO_STEPS }, (_, i) => i + 1), DEMO_STEPS]);
    for (let i = 0; i < captions.length - 1; i++) {
      const c = captions[i]!;
      expect(captions[i + 1]!.at - c.at).toBeGreaterThanOrEqual(readingTime(c.text) - 400);
    }
    // every step tells the camera what to frame
    expect(captions.every((c) => c.focus !== null)).toBe(true);
  });

  it('closes the caption when stopped', async () => {
    const store = new StateStore();
    const ctl = { speed: 1, paused: false, aborted: false };
    let id = '';
    const p = runGuidedDemo(inProcess(store), ctl, (sid) => (id = sid));
    setTimeout(() => (ctl.aborted = true), 50);
    await expect(p).rejects.toBeInstanceOf(DemoAborted);
    store.flush();
    expect(store.sessions.get(id)?.narration).toMatchObject({ title: 'Démo arrêtée', done: true });
  });

  it('can be stopped and restarted', async () => {
    const store = new StateStore();
    const runner = new DemoRunner(inProcess(store));
    const first = await runner.start(10);
    expect(runner.status).toMatchObject({ running: true, sessionId: first });
    runner.setPaused(true);
    expect(runner.status.paused).toBe(true);
    const second = await runner.start(10);
    expect(second).not.toBe(first);
    runner.stop();
    await new Promise((r) => setTimeout(r, 150));
    expect(runner.status.running).toBe(false);
  });

  it('aborts promptly', async () => {
    const ctl = { speed: 1, paused: false, aborted: false };
    const p = runGuidedDemo(inProcess(new StateStore()), ctl);
    setTimeout(() => (ctl.aborted = true), 50);
    await expect(p).rejects.toBeInstanceOf(DemoAborted);
  });
});
