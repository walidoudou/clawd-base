import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { FastifyInstance } from 'fastify';
import { StateStore } from '@dash/shared';
import { buildApp } from '../src/app.ts';
import { Ingest } from '../src/ingest.ts';
import { SseHub } from '../src/sse.ts';
import { TranscriptWatcher } from '../src/watcher.ts';
import { EventLog } from '../src/persist.ts';
import { readCapped, SnapshotStore } from '../src/snapshots.ts';
import type { ServerConfig } from '../src/config.ts';
import { SID, assistantLines, promptLine, toolResultLine, toolUse } from '../../shared/test/fixtures.ts';

const root = mkdtempSync(join(tmpdir(), 'clawd-base-test-'));
const projects = join(root, 'projects');
const project = join(projects, '-tmp-demo');
const work = join(root, 'work');
mkdirSync(project, { recursive: true });
mkdirSync(work, { recursive: true });

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  projectsDir: projects,
  dataDir: join(root, 'data'),
  persist: false,
  maxAgeHours: 24,
  spriteSet: 'clawd',
  locale: 'fr',
  webDir: null,
  version: 'test',
};

let store: StateStore;
let ingest: Ingest;
let hub: SseHub;
let watcher: TranscriptWatcher;
let app: FastifyInstance;

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const hostHeader = () => ({ host: `127.0.0.1:${config.port}` });

beforeAll(async () => {
  // A transcript that already exists before the server starts.
  writeFileSync(join(project, `${SID}.jsonl`), `${[promptLine(0, 'Bonjour'), ...assistantLines(1, 'msg_1', [toolUse('t1', 'Bash', { command: 'ls' })])].join('\n')}\n`);
  store = new StateStore();
  ingest = new Ingest(store, null);
  hub = new SseHub(store, 20);
  app = buildApp({ config, store, ingest, hub, stats: () => ({}) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  config.port = typeof addr === 'object' && addr ? addr.port : 0;
  hub.start();
  watcher = new TranscriptWatcher(projects, 24 * 3600 * 1000, (evs) => ingest.applyTranscript(evs));
  await watcher.start();
});

afterAll(async () => {
  hub.stop();
  await watcher.stop();
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('transcript watcher', () => {
  it('loads existing transcripts at startup', () => {
    expect(store.sessions.has(SID)).toBe(true);
    expect(store.agents.get(SID)?.turns).toBe(1);
    expect(store.tools.get('t1')?.status).toBe('running');
  });

  it('tails appended lines (including a line split across two writes)', async () => {
    const line = toolResultLine(2, 't1', 'ok', { stdout: 'ok', stderr: '', interrupted: false });
    appendFileSync(join(project, `${SID}.jsonl`), line.slice(0, 40));
    await new Promise((r) => setTimeout(r, 300));
    appendFileSync(join(project, `${SID}.jsonl`), `${line.slice(40)}\n`);
    await waitFor(() => store.tools.get('t1')?.status === 'ok');
    expect(store.tools.get('t1')?.output).toBe('ok');
  });

  it('picks up sub-agent transcripts and their meta.json', async () => {
    appendFileSync(join(project, `${SID}.jsonl`), `${assistantLines(3, 'msg_2', [toolUse('tA', 'Agent', { subagent_type: 'Explore', description: 'Explorer', prompt: 'Cherche' })]).join('\n')}\n`);
    const sub = join(project, SID, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Explorer', toolUseId: 'tA' }));
    writeFileSync(join(sub, 'agent-abc123.jsonl'), `${assistantLines(4, 'msg_s', [toolUse('ts1', 'Read', { file_path: '/x/y.ts' })], { agentId: 'abc123', model: 'claude-haiku-4-5-20251001' }).join('\n')}\n`);
    await waitFor(() => store.agents.get('abc123')?.spawnToolUseId === 'tA' && store.tools.has('ts1'));
    const a = store.agents.get('abc123');
    expect(a).toMatchObject({ type: 'Explore', description: 'Explorer', parentId: SID, model: 'claude-haiku-4-5-20251001' });
    expect(store.agents.has('t:tA')).toBe(false);
  });
});

describe('hooks endpoint', () => {
  it('captures a snapshot at PreToolUse and diffs it after the edit', async () => {
    const file = join(work, 'code.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const base = { session_id: 'hook-session', transcript_path: '/nope.jsonl', cwd: work };
    const pre = await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: file, old_string: 'b', new_string: 'B' } } });
    expect(pre.statusCode).toBe(204);
    writeFileSync(file, 'a\nB\nc\n');
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: file, old_string: 'b', new_string: 'B' }, tool_response: 'ok' } });
    const change = store.files.get('e1');
    expect(change).toMatchObject({ operation: 'edit', added: 1, removed: 1, diffSource: 'snapshot' });
    expect(change?.hunks[0]?.lines).toEqual([' a', '-b', '+B', ' c']);
  });

  it('never fails, even with garbage', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/hook', headers: { ...hostHeader(), 'content-type': 'application/json' }, payload: '{"broken":' });
    expect([204, 400]).toContain(r.statusCode);
    const r2 = await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { hello: 'world' } });
    expect(r2.statusCode).toBe(204);
  });

  it('rejects foreign Host headers and cross-site POSTs', async () => {
    const evil = await app.inject({ method: 'GET', url: '/api/state', headers: { host: 'evil.example:4317' } });
    expect(evil.statusCode).toBe(403);
    const csrf = await app.inject({ method: 'POST', url: '/api/hook', headers: { ...hostHeader(), origin: 'https://evil.example' }, payload: {} });
    expect(csrf.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/health', headers: hostHeader() });
    expect(ok.json()).toMatchObject({ ok: true, app: 'clawd-base' });
  });
});

describe('SSE stream', () => {
  it('sends a snapshot on connect, then patches', async () => {
    const chunks: string[] = [];
    const req = http.get({ host: '127.0.0.1', port: config.port, path: '/api/stream', headers: hostHeader() });
    const res = await new Promise<http.IncomingMessage>((resolve) => req.on('response', resolve));
    res.setEncoding('utf8');
    res.on('data', (c: string) => chunks.push(c));
    await waitFor(() => chunks.join('').includes('event: snapshot'));
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { session_id: 'sse-session', hook_event_name: 'UserPromptSubmit', prompt: 'coucou', prompt_id: 'p' } });
    await waitFor(() => chunks.join('').includes('event: patch') && chunks.join('').includes('sse-session'));
    req.destroy();
  });

  it('replays missed batches with Last-Event-ID', async () => {
    hub.flush();
    const idBefore = hub.lastEventId;
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { session_id: 'replay-session', hook_event_name: 'UserPromptSubmit', prompt: 'manqué', prompt_id: 'q' } });
    hub.flush();
    const chunks: string[] = [];
    const req = http.get({ host: '127.0.0.1', port: config.port, path: '/api/stream', headers: { ...hostHeader(), 'last-event-id': idBefore } });
    const res = await new Promise<http.IncomingMessage>((resolve) => req.on('response', resolve));
    res.setEncoding('utf8');
    res.on('data', (c: string) => chunks.push(c));
    await waitFor(() => chunks.join('').includes('replay-session'));
    expect(chunks.join('')).not.toContain('event: snapshot');
    req.destroy();
  });
});

describe('SSE across restarts', () => {
  it('a Last-Event-ID from another server instance gets a snapshot, not a replay', async () => {
    const chunks: string[] = [];
    const req = http.get({ host: '127.0.0.1', port: config.port, path: '/api/stream', headers: { ...hostHeader(), 'last-event-id': 'zzzz-1' } });
    const res = await new Promise<http.IncomingMessage>((resolve) => req.on('response', resolve));
    res.setEncoding('utf8');
    res.on('data', (c: string) => chunks.push(c));
    await waitFor(() => chunks.join('').includes('event: snapshot'));
    req.destroy();
  });
});

describe('watcher robustness', () => {
  it('keeps tailing after an apply error and decodes UTF-8 split across writes', async () => {
    const dir = join(root, 'projects2', '-tmp-robust');
    mkdirSync(dir, { recursive: true });
    const sid = '11111111-2222-3333-4444-555555555555';
    const file = join(dir, `${sid}.jsonl`);
    writeFileSync(file, '');
    const got: string[] = [];
    let failOnce = true;
    const errors: string[] = [];
    const w = new TranscriptWatcher(join(root, 'projects2'), 24 * 3600 * 1000, (evs) => {
      for (const e of evs) if (e.kind === 'prompt') {
        if (failOnce) {
          failOnce = false;
          throw new Error('boom');
        }
        got.push(e.text);
      }
    }, (m) => errors.push(m));
    await w.start();
    const line = (text: string, id: string) => JSON.stringify({ type: 'user', sessionId: sid, uuid: id, timestamp: new Date().toISOString(), promptId: id, origin: { kind: 'human' }, message: { role: 'user', content: text } });
    appendFileSync(file, `${line('premier', 'p1')}\n`);
    await waitFor(() => errors.some((e) => e.includes('boom')));
    // "é" is 2 bytes in UTF-8: split it across two writes.
    const buf = Buffer.from(`${line('résumé', 'p2')}\n`, 'utf8');
    const cut = buf.indexOf(Buffer.from('é', 'utf8')) + 1;
    appendFileSync(file, buf.subarray(0, cut));
    await new Promise((r) => setTimeout(r, 400));
    appendFileSync(file, buf.subarray(cut));
    await waitFor(() => got.includes('résumé'));
    await w.stop();
  });
});

describe('persistence and snapshots', () => {
  it('stores and reloads hook events with node:sqlite', async () => {
    const log = await EventLog.open(join(root, 'db'), () => {});
    expect(log.enabled).toBe(true);
    log.append([{ kind: 'prompt', sessionId: 's', at: Date.now(), source: 'hook', agentId: 's', text: 'persisté', promptId: 'x' }]);
    log.flush();
    const back = log.loadSince(Date.now() - 60_000);
    expect(back).toEqual([expect.objectContaining({ kind: 'prompt', text: 'persisté' })]);
    log.close();
  });

  it('readCapped distinguishes missing, too big and binary files', async () => {
    const small = join(work, 'small.txt');
    const big = join(work, 'big.txt');
    const bin = join(work, 'bin.dat');
    writeFileSync(small, 'hello');
    writeFileSync(big, 'x'.repeat(2048));
    writeFileSync(bin, Buffer.from([1, 0, 2]));
    expect(await readCapped(small)).toBe('hello');
    expect(await readCapped(join(work, 'missing.txt'))).toBeNull();
    expect(await readCapped(big, 1024)).toBeUndefined();
    expect(await readCapped(bin)).toBeUndefined();
  });

  it('SnapshotStore evicts beyond its byte budget', () => {
    const s = new SnapshotStore(10);
    s.set('a', '123456');
    s.set('b', '123456');
    expect(s.take('a')).toBeUndefined();
    expect(s.take('b')).toBe('123456');
    expect(s.take('b')).toBeUndefined();
  });
});
