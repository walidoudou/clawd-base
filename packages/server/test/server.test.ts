import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/** This run's token, as index.ts would generate it and write it to server.json. */
const TOKEN = 'c0ffee'.repeat(10) + 'c0ff';
const BUNDLE = '/opt/clawd-base/dist/server.mjs';
let shutdownCalls = 0;

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
/** Headers of our own hook script (send-event.mjs read the token from server.json). */
const trustedHeaders = () => ({ ...hostHeader(), 'x-clawd-token': TOKEN });

beforeAll(async () => {
  // A transcript that already exists before the server starts.
  writeFileSync(join(project, `${SID}.jsonl`), `${[promptLine(0, 'Bonjour'), ...assistantLines(1, 'msg_1', [toolUse('t1', 'Bash', { command: 'ls' })])].join('\n')}\n`);
  store = new StateStore();
  ingest = new Ingest(store, null);
  hub = new SseHub(store, 20);
  app = buildApp({ config, store, ingest, hub, stats: () => ({}), token: TOKEN, bundle: BUNDLE, shutdown: () => void shutdownCalls++ });
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
  it('captures a snapshot at PreToolUse and diffs it after the edit (token: trusted)', async () => {
    const file = join(work, 'code.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const base = { session_id: 'hook-session', transcript_path: '/nope.jsonl', cwd: work };
    const pre = await app.inject({ method: 'POST', url: '/api/hook', headers: trustedHeaders(), payload: { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: file, old_string: 'b', new_string: 'B' } } });
    expect(pre.statusCode).toBe(204);
    writeFileSync(file, 'a\nB\nc\n');
    await app.inject({ method: 'POST', url: '/api/hook', headers: trustedHeaders(), payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: file, old_string: 'b', new_string: 'B' }, tool_response: 'ok' } });
    const change = store.files.get('e1');
    expect(change).toMatchObject({ operation: 'edit', added: 1, removed: 1, diffSource: 'snapshot' });
    expect(change?.hunks[0]?.lines).toEqual([' a', '-b', '+B', ' c']);
  });

  it('processes a tokenless hook without reading anything from disk', async () => {
    // Another local account forges hooks whose file_path points at a file only we can read.
    const secret = join(work, 'id_secret');
    const empty = join(work, 'empty.txt');
    writeFileSync(secret, 'line one\nTOP-SECRET-7f3a9c\nline three\n');
    writeFileSync(empty, '');
    const base = { session_id: 'forged-session', transcript_path: '/nope.jsonl', cwd: work };
    for (const bad of ['', 'wrong', TOKEN.slice(0, -1), `${TOKEN}0`]) {
      const headers = bad ? { ...hostHeader(), 'x-clawd-token': bad } : hostHeader();
      const id = `forged-${bad.length}`;
      // Snapshot the secret at PreToolUse, then "write" an empty file under the same id: with disk
      // reads, the diff would list every line of the secret as removed.
      expect((await app.inject({ method: 'POST', url: '/api/hook', headers, payload: { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: id, tool_input: { file_path: secret, content: '' } } })).statusCode).toBe(204);
      expect((await app.inject({ method: 'POST', url: '/api/hook', headers, payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: id, tool_input: { file_path: empty, content: '' }, tool_response: {} } })).statusCode).toBe(204);
      // Still processed, from the payload alone.
      expect(store.files.get(id)).toMatchObject({ path: empty, diffSource: 'strings', removed: 0 });
    }
    // Line-number oracle: an Edit's position used to come from searching new_string in the file on disk.
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'forged-e', tool_input: { file_path: secret, old_string: 'zzz', new_string: 'line three' }, tool_response: 'ok' } });
    expect(store.files.get('forged-e')).toMatchObject({ path: secret, diffSource: 'strings' });
    expect(store.files.get('forged-e')?.hunks.every((h) => h.newStart === 0)).toBe(true);
    expect(ingest.snapshots.size).toBe(0);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: hostHeader() });
    expect(state.statusCode).toBe(200);
    expect(state.body).toContain('forged-session');
    expect(state.body).not.toContain('TOP-SECRET');
    expect(state.body).not.toContain('line one');
  });

  it("a tokenless PostToolUse cannot take the snapshot of a trusted call", async () => {
    const file = join(work, 'private.ts');
    writeFileSync(file, 'keep\nPRIVATE-LINE\nkeep\n');
    const base = { session_id: 'hook-session', transcript_path: '/nope.jsonl', cwd: work };
    const input = { file_path: file, old_string: 'keep', new_string: 'kept' };
    await app.inject({ method: 'POST', url: '/api/hook', headers: trustedHeaders(), payload: { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e2', tool_input: input } });
    // The tool id is visible in /api/state: a forger races the real PostToolUse with an empty Write.
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'e2', tool_input: { file_path: file, content: '' }, tool_response: {} } });
    await app.inject({ method: 'POST', url: '/api/hook', headers: hostHeader(), payload: { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Edit', tool_use_id: 'e2', tool_input: input } });
    expect(JSON.stringify(store.files.get('e2'))).not.toContain('PRIVATE-LINE');
    writeFileSync(file, 'kept\nPRIVATE-LINE\nkeep\n');
    await app.inject({ method: 'POST', url: '/api/hook', headers: trustedHeaders(), payload: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e2', tool_input: input, tool_response: 'ok' } });
    expect(store.files.get('e2')).toMatchObject({ diffSource: 'snapshot', added: 1, removed: 1 });
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

describe('health and shutdown', () => {
  it('reports the running bundle, never the token', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: hostHeader() });
    expect(r.json()).toMatchObject({ ok: true, app: 'clawd-base', bundle: BUNDLE, pid: process.pid });
    for (const url of ['/api/health', '/api/state', '/api/config', '/debug']) {
      expect((await app.inject({ method: 'GET', url, headers: hostHeader() })).body).not.toContain(TOKEN);
    }
  });

  it('POST /api/shutdown needs the token (and still the local Host/Origin guard)', async () => {
    const before = shutdownCalls;
    expect((await app.inject({ method: 'POST', url: '/api/shutdown', headers: hostHeader() })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/shutdown', headers: { ...hostHeader(), 'x-clawd-token': 'nope' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/shutdown', headers: { ...trustedHeaders(), origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/shutdown', headers: { 'x-clawd-token': TOKEN, host: 'evil.example:4317' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/shutdown', headers: trustedHeaders() })).statusCode).not.toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(shutdownCalls).toBe(before);
    const ok = await app.inject({ method: 'POST', url: '/api/shutdown', headers: trustedHeaders() });
    expect(ok.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(shutdownCalls).toBe(before + 1);
  });

  it('without a token configured, nothing is trusted and shutdown is refused', async () => {
    const s = new StateStore();
    const bare = buildApp({ config, store: s, ingest: new Ingest(s, null), hub: new SseHub(s), stats: () => ({}), shutdown: () => void shutdownCalls++ });
    const before = shutdownCalls;
    expect((await bare.inject({ method: 'POST', url: '/api/shutdown', headers: { ...hostHeader(), 'x-clawd-token': '' } })).statusCode).toBe(403);
    expect((await bare.inject({ method: 'GET', url: '/api/health', headers: hostHeader() })).json()).toMatchObject({ bundle: null });
    expect(shutdownCalls).toBe(before);
    await bare.close();
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
  it('stores and reloads hook events with node:sqlite, in owner-only files', async () => {
    const dir = join(root, 'db');
    const log = await EventLog.open(dir, () => {});
    expect(log.enabled).toBe(true);
    log.append([{ kind: 'prompt', sessionId: 's', at: Date.now(), source: 'hook', agentId: 's', text: 'persisté', promptId: 'x' }]);
    log.flush();
    const back = log.loadSince(Date.now() - 60_000);
    expect(back).toEqual([expect.objectContaining({ kind: 'prompt', text: 'persisté' })]);
    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const f of ['events.db', 'events.db-wal', 'events.db-shm']) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    }
    log.close();
  });

  it('tightens an existing ~/.clawd-base and database created with default permissions', async () => {
    if (process.platform === 'win32') return;
    const dir = join(root, 'home-loose', '.clawd-base');
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    writeFileSync(join(dir, 'events.db'), '', { mode: 0o644 });
    const log = await EventLog.open(dir, () => {});
    expect(log.enabled).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'events.db')).mode & 0o777).toBe(0o600);
    log.close();
  });

  it('leaves the permissions of a folder the user chose as data dir alone (its files are still private)', async () => {
    if (process.platform === 'win32') return;
    const dir = join(root, 'my-documents');
    mkdirSync(dir, { mode: 0o755 });
    const log = await EventLog.open(dir, () => {});
    expect(statSync(dir).mode & 0o777).toBe(0o755);
    expect(statSync(join(dir, 'events.db')).mode & 0o777).toBe(0o600);
    log.close();
  });

  it('hooks received before the log opens (it opens after listen) are persisted once it is attached', async () => {
    const s = new StateStore();
    const ing = new Ingest(s, null);
    ing.deferLog();
    await ing.handleHook({ session_id: 'early', hook_event_name: 'UserPromptSubmit', prompt: 'avant', prompt_id: 'e' });
    expect(s.sessions.has('early')).toBe(true);
    const log = await EventLog.open(join(root, 'db-late'), () => {});
    expect(log.loadSince(0)).toEqual([]);
    ing.attachLog(log);
    await ing.handleHook({ session_id: 'early', hook_event_name: 'UserPromptSubmit', prompt: 'après', prompt_id: 'f' });
    log.flush();
    expect(log.loadSince(0).map((e) => (e.kind === 'prompt' ? e.text : e.kind))).toEqual(['avant', 'après']);
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
