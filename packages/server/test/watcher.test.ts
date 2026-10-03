import { afterAll, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { NormalizedEvent } from '@dash/shared';
import { TranscriptWatcher } from '../src/watcher.ts';
import { SID, assistantLines, promptLine, toolUse } from '../../shared/test/fixtures.ts';

const root = mkdtempSync(join(tmpdir(), 'clawd-base-watcher-'));
const HOUR = 3600 * 1000;
const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const watchers: TranscriptWatcher[] = [];

afterAll(async () => {
  await Promise.all(watchers.map((w) => w.stop()));
  rmSync(root, { recursive: true, force: true });
});

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A watcher whose emitted prompt texts are collected. */
function make(dir: string, opts: ConstructorParameters<typeof TranscriptWatcher>[4] = {}, maxAgeMs = 24 * HOUR) {
  const prompts: string[] = [];
  const errors: string[] = [];
  const w = new TranscriptWatcher(dir, maxAgeMs, (evs) => {
    for (const e of evs) if (e.kind === 'prompt') prompts.push(e.text);
  }, (m) => errors.push(m), opts);
  watchers.push(w);
  return { w, prompts, errors };
}

const age = (file: string, ms: number) => {
  const t = (Date.now() - ms) / 1000;
  utimesSync(file, t, t);
};

describe('watcher: projects dir created later', () => {
  it('resolves start() at once, reports it once, then picks the directory up', async () => {
    const dir = join(root, 'later', 'projects');
    const { w, prompts, errors } = make(dir, { missingPollMs: 50 });
    const t0 = Date.now();
    await w.start();
    expect(Date.now() - t0).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 250)); // several polls
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(dir);
    mkdirSync(join(dir, '-tmp-later'), { recursive: true });
    writeFileSync(join(dir, '-tmp-later', `${sid(1)}.jsonl`), `${promptLine(0, 'enfin là')}\n`);
    await waitFor(() => prompts.includes('enfin là'));
    expect(w.trackedFiles).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

describe('watcher: ignored sub-trees', () => {
  it('matches them relative to the projects dir (a projects dir under .../tasks/ still works)', async () => {
    const dir = join(root, 'tasks', 'projects');
    const slug = join(dir, '-tmp-ignored');
    mkdirSync(join(slug, 'memory'), { recursive: true });
    mkdirSync(join(slug, sid(2), 'tool-results'), { recursive: true });
    writeFileSync(join(slug, `${sid(2)}.jsonl`), `${promptLine(0, 'visible')}\n`);
    writeFileSync(join(slug, 'memory', `${sid(3)}.jsonl`), `${promptLine(0, 'mémoire')}\n`);
    writeFileSync(join(slug, sid(2), 'tool-results', `${sid(4)}.jsonl`), `${promptLine(0, 'résultat')}\n`);
    const { w, prompts } = make(dir);
    await w.start();
    expect(prompts).toEqual(['visible']);
    expect(w.trackedFiles).toBe(1);
  });
});

describe('watcher: initial scan', () => {
  it('reads main transcripts, then meta files, then sub-agent transcripts', async () => {
    const dir = join(root, 'order');
    const slug = join(dir, '-tmp-order');
    const sub = join(slug, SID, 'subagents');
    mkdirSync(sub, { recursive: true });
    // A big main transcript (several 1 MB chunks) and tiny meta/sub-agent files: read concurrently,
    // the small ones would win.
    const filler = Array.from({ length: 6000 }, (_, i) => promptLine(i % 60, `prompt ${i} ${'x'.repeat(300)}`, `p-${i}`));
    writeFileSync(join(slug, `${SID}.jsonl`), `${[...filler, ...assistantLines(1, 'msg_1', [toolUse('tA', 'Agent', { subagent_type: 'Explore', description: 'Explorer', prompt: 'Cherche' })])].join('\n')}\n`);
    writeFileSync(join(sub, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'META-DESC', toolUseId: 'tA' }));
    writeFileSync(join(sub, 'agent-abc123.jsonl'), `${assistantLines(2, 'msg_s', [toolUse('ts1', 'Read', { file_path: '/x/y.ts' })], { agentId: 'abc123' }).join('\n')}\n`);
    const order: string[] = [];
    const tag = (evs: NormalizedEvent[]): string => {
      if (evs.some((e) => e.kind === 'agent.start' && e.description === 'META-DESC')) return 'meta';
      return evs.some((e) => 'agentId' in e && e.agentId === 'abc123') ? 'sub' : 'main';
    };
    const w = new TranscriptWatcher(dir, 24 * HOUR, (evs) => order.push(tag(evs)), () => {}, { concurrency: 8 });
    watchers.push(w);
    await w.start();
    expect(order.length).toBeGreaterThan(3);
    expect(order[0]).toBe('main');
    const rank = { main: 0, meta: 1, sub: 2 } as Record<string, number>;
    for (let i = 1; i < order.length; i++) expect(rank[order[i] as string]).toBeGreaterThanOrEqual(rank[order[i - 1] as string] as number);
    expect(order).toContain('meta');
    expect(order.at(-1)).toBe('sub');
  });
});

describe('watcher: dormant transcripts', () => {
  it('neither reads nor watches old transcripts, and adopts one modified later', async () => {
    const dir = join(root, 'dormant');
    const slug = join(dir, '-tmp-dormant');
    mkdirSync(slug, { recursive: true });
    const old = join(slug, `${sid(5)}.jsonl`);
    const recent = join(slug, `${sid(6)}.jsonl`);
    writeFileSync(old, `${promptLine(0, 'ancien')}\n`);
    age(old, 3 * 24 * HOUR);
    writeFileSync(recent, `${promptLine(0, 'récent')}\n`);
    const { w, prompts } = make(dir, { rescanMs: 100 }, HOUR);
    await w.start();
    expect(prompts).toEqual(['récent']);
    expect(w.trackedFiles).toBe(1);
    // No fd / inotify watch for the dormant file.
    const watched = (w as unknown as { watcher: FSWatcher }).watcher.getWatched();
    expect(watched[slug]).toEqual([`${sid(6)}.jsonl`]);

    appendFileSync(old, `${promptLine(1, 'repris')}\n`); // the old session is resumed
    await waitFor(() => prompts.includes('repris'));
    expect(prompts).toEqual(['récent', 'ancien', 'repris']); // read from the start, once
    expect(w.trackedFiles).toBe(2);
    await waitFor(() => (w as unknown as { watcher: FSWatcher }).watcher.getWatched()[slug]?.length === 2);
    appendFileSync(old, `${promptLine(2, 'encore')}\n`);
    await waitFor(() => prompts.includes('encore'));
    expect(prompts.filter((p) => p === 'ancien')).toHaveLength(1);
  });

  it('rescan() adopts a dormant file only once its mtime moves, within the usual depth and sub-trees', async () => {
    // No chokidar here (the directory appears after start and the wait poll is long): only the rescan can see it.
    const dir = join(root, 'rescan');
    const { w, prompts } = make(dir, { missingPollMs: 60_000 }, HOUR);
    await w.start();
    const slug = join(dir, '-tmp-rescan');
    mkdirSync(join(slug, 'memory'), { recursive: true });
    const deep = join(slug, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    const old = join(slug, `${sid(7)}.jsonl`);
    writeFileSync(old, `${promptLine(0, 'vieux')}\n`);
    age(old, 3 * 24 * HOUR);
    writeFileSync(join(slug, 'memory', `${sid(8)}.jsonl`), `${promptLine(0, 'mémoire')}\n`);
    writeFileSync(join(deep, `${sid(9)}.jsonl`), `${promptLine(0, 'trop profond')}\n`);
    await w.rescan();
    expect(w.trackedFiles).toBe(0);
    expect(prompts).toEqual([]);
    appendFileSync(old, `${promptLine(1, 'réveillé')}\n`);
    await w.rescan();
    expect(w.trackedFiles).toBe(1);
    expect(prompts).toEqual(['vieux', 'réveillé']);
    await w.rescan(); // tracked now: not read twice
    expect(prompts).toEqual(['vieux', 'réveillé']);
  });
});
