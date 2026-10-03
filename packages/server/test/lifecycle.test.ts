import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The real server process (src/index.ts under tsx, on a random port and its own data dir): server.json
 * handshake, permissions, authenticated shutdown, exit code 3 when the port is taken, and the whole
 * hook chain (send-event.mjs → token → trusted snapshot).
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const entry = join(repo, 'packages', 'server', 'src', 'index.ts');
const sendEvent = join(repo, 'scripts', 'send-event.mjs');
const root = mkdtempSync(join(tmpdir(), 'clawd-base-lifecycle-'));
const children = new Set<ChildProcess>();

afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

interface Info { app: string; port: number; pid: number; token: string; bundle: string; startedAt: string }

function server(dataDir: string, port = 0): { child: ChildProcess; exited: Promise<number | null>; log: () => string } {
  const projects = join(root, 'projects');
  mkdirSync(projects, { recursive: true });
  const child = spawn(process.execPath, ['--import', 'tsx', entry, '--port', String(port), '--data-dir', dataDir, '--projects-dir', projects], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  return { child, exited, log: () => out };
}

async function waitFor<T>(get: () => T | null | undefined | false, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const readInfo = (dataDir: string): Info | null => {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8')) as Info;
  } catch {
    return null;
  }
};

function hook(dataDir: string, payload: unknown): Promise<number | null> {
  return new Promise((resolve) => {
    // CLAWD_BASE_PORT points nowhere: the port must come from server.json.
    const p = spawn(process.execPath, [sendEvent], { env: { ...process.env, CLAWD_BASE_DATA_DIR: dataDir, CLAWD_BASE_PORT: '9' } });
    p.on('close', resolve);
    p.stdin.end(JSON.stringify(payload));
  });
}

describe('server process lifecycle', () => {
  it('writes a private server.json once it owns the port, and only a valid token shuts it down', async () => {
    const dataDir = join(root, 'data-a');
    const a = server(dataDir);
    const info = await waitFor(() => readInfo(dataDir));
    expect(info).toMatchObject({ app: 'clawd-base', pid: a.child.pid, bundle: entry });
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
    expect(info.port).toBeGreaterThan(0);
    if (process.platform !== 'win32') {
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, 'server.json')).mode & 0o777).toBe(0o600);
    }
    const base = `http://127.0.0.1:${info.port}`;
    // server.json is written after listen: the server already answers.
    const health = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ app: 'clawd-base', pid: a.child.pid, port: info.port, bundle: entry, persist: true });
    expect(JSON.stringify(health)).not.toContain(info.token);
    if (process.platform !== 'win32') expect(statSync(join(dataDir, 'events.db')).mode & 0o777).toBe(0o600);

    // A second server on the same port exits with code 3 and leaves server.json alone.
    const loser = server(dataDir, info.port);
    expect(await loser.exited).toBe(3);
    expect(readInfo(dataDir)?.pid).toBe(a.child.pid);

    expect((await fetch(`${base}/api/shutdown`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'X-Clawd-Token': 'f'.repeat(64) } })).status).toBe(403);
    expect(a.child.exitCode).toBeNull();
    expect((await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'X-Clawd-Token': info.token } })).status).toBe(202);
    expect(await a.exited).toBe(0);
    expect(existsSync(join(dataDir, 'server.json'))).toBe(false);
  });

  it('trusts our hook script (token from server.json) with snapshots, not a tokenless request', async () => {
    const dataDir = join(root, 'data-b');
    const b = server(dataDir);
    const info = await waitFor(() => readInfo(dataDir));
    const base = `http://127.0.0.1:${info.port}`;
    const file = join(root, 'edited.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const call = (id: string, event: string) => ({ session_id: 'e2e', transcript_path: '/nope.jsonl', cwd: root, hook_event_name: event, tool_name: 'Edit', tool_use_id: id, tool_input: { file_path: file, old_string: 'b', new_string: 'B' }, ...(event === 'PostToolUse' ? { tool_response: 'ok' } : {}) });
    expect(await hook(dataDir, call('via-hook', 'PreToolUse'))).toBe(0);
    writeFileSync(file, 'a\nB\nc\n');
    expect(await hook(dataDir, call('via-hook', 'PostToolUse'))).toBe(0);
    for (const event of ['PreToolUse', 'PostToolUse']) {
      await fetch(`${base}/api/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call('tokenless', event)) });
    }
    const state = (await (await fetch(`${base}/api/state`)).json()) as { files: Array<{ id: string; diffSource: string }> };
    expect(state.files.find((f) => f.id === 'via-hook')?.diffSource).toBe('snapshot');
    expect(state.files.find((f) => f.id === 'tokenless')?.diffSource).toBe('strings');
    b.child.kill('SIGTERM');
    expect(await b.exited).toBe(0);
    expect(existsSync(join(dataDir, 'server.json'))).toBe(false);
  });

  it('on exit, leaves a server.json that now belongs to another server', async () => {
    const dataDir = join(root, 'data-c');
    const c = server(dataDir);
    const info = await waitFor(() => readInfo(dataDir));
    await waitFor(() => c.log().includes('transcript(s) suivis'));
    writeFileSync(join(dataDir, 'server.json'), JSON.stringify({ ...info, pid: info.pid + 1 }));
    c.child.kill('SIGTERM');
    expect(await c.exited).toBe(0);
    expect(readInfo(dataDir)?.pid).toBe(info.pid + 1);
  });
});
