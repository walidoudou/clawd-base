import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/send-event.mjs', import.meta.url));
// Real path: Node reports the main module's real path (macOS: /var → /private/var).
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'clawd-base-scripts-')));
/** Every spawned script gets its own data dir: never the user's ~/.clawd-base (and its live server.json). */
const emptyDataDir = join(tmp, 'empty-data');
mkdirSync(emptyDataDir);

/** Pids of the servers started by these tests, killed in afterAll whatever happens. */
const started = new Set<number>();
afterAll(() => {
  for (const pid of started) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  rmSync(tmp, { recursive: true, force: true });
});

function run(payload: string, port: number, dataDir = emptyDataDir): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn(process.execPath, [script], { env: { ...process.env, CLAWD_BASE_PORT: String(port), CLAWD_BASE_DATA_DIR: dataDir } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - start }));
    p.stdin.end(payload);
  });
}

/** A local HTTP server recording what POST /api/hook receives. */
async function hookSink(): Promise<{ port: number; received: Array<{ body: string; token: string | undefined }>; close: () => void }> {
  const received: Array<{ body: string; token: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const token = req.headers['x-clawd-token'];
      if (req.url === '/api/hook' && req.method === 'POST') received.push({ body, token: typeof token === 'string' ? token : undefined });
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return { port: typeof addr === 'object' && addr ? addr.port : 0, received, close: () => server.close() };
}

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const addr = s.address();
  await new Promise<void>((r) => s.close(() => r()));
  return typeof addr === 'object' && addr ? addr.port : 0;
}

describe('scripts/send-event.mjs (hook)', () => {
  it('exits 0 quickly and silently when the server is down', async () => {
    const r = await run('{"session_id":"x","hook_event_name":"Stop"}', 9); // nothing listens on port 9
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1600);
  });

  it('exits 0 on empty or invalid input', async () => {
    expect((await run('', 9)).code).toBe(0);
    expect((await run('not json', 9)).code).toBe(0);
  });

  it('forwards the payload unchanged to POST /api/hook (no server.json: configured port, no token)', async () => {
    const sink = await hookSink();
    const payload = '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash"}';
    const r = await run(payload, sink.port);
    sink.close();
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(sink.received).toEqual([{ body: payload, token: undefined }]);
  });

  it('uses the port and token from <data dir>/server.json, over the env port', async () => {
    const sink = await hookSink();
    const dataDir = join(tmp, 'hook-data');
    mkdirSync(dataDir);
    const token = 'ab'.repeat(32);
    writeFileSync(join(dataDir, 'server.json'), JSON.stringify({ app: 'clawd-base', port: sink.port, pid: 1, token, bundle: '/x/dist/server.mjs', startedAt: '' }));
    const payload = '{"session_id":"s2","hook_event_name":"Stop"}';
    const r = await run(payload, 9, dataDir); // env says port 9: server.json wins
    sink.close();
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1600);
    expect(sink.received).toEqual([{ body: payload, token }]);
  });

  it('ignores a server.json that is not ours', async () => {
    const sink = await hookSink();
    const dataDir = join(tmp, 'hook-data-foreign');
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, 'server.json'), JSON.stringify({ app: 'something-else', port: 9, token: 'ff'.repeat(32) }));
    const r = await run('{"session_id":"s3","hook_event_name":"Stop"}', sink.port, dataDir);
    sink.close();
    expect(r.code).toBe(0);
    expect(sink.received).toEqual([{ body: '{"session_id":"s3","hook_event_name":"Stop"}', token: undefined }]);
  });
});

const startScript = fileURLToPath(new URL('../../../scripts/start.mjs', import.meta.url));
const hooksJson = fileURLToPath(new URL('../../../hooks/hooks.json', import.meta.url));

function runStart(args: string[], env: Record<string, string> = {}, nodeArgs: string[] = [], file = startScript): Promise<{ code: number | null; out: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [...nodeArgs, file, '--no-open', ...args], { env: { ...process.env, LANG: 'en_US.UTF-8', CLAWD_BASE_DATA_DIR: emptyDataDir, ...env } });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (out += d.toString()));
    p.on('close', (code) => {
      for (const m of out.matchAll(/\(pid (\d+)\)/g)) started.add(Number(m[1]));
      resolve({ code, out, ms: Date.now() - t0 });
    });
  });
}

/**
 * A stand-in for a packaged dist/server.mjs with the same contract as the real one: exit 3 on
 * EADDRINUSE, server.json (port, pid, token, bundle) in the data dir, /api/health with `bundle`,
 * POST /api/shutdown that needs the token.
 */
const FAKE_SERVER = `
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const info = join(process.env.CLAWD_BASE_DATA_DIR, 'server.json');
const token = randomBytes(32).toString('hex');
const bundle = fileURLToPath(import.meta.url);
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, app: 'clawd-base', pid: process.pid, port, bundle }));
  if (req.url === '/api/shutdown' && req.method === 'POST' && req.headers['x-clawd-token'] === token) {
    res.statusCode = 202;
    res.end();
    rmSync(info, { force: true });
    server.close(() => process.exit(0));
    server.closeAllConnections();
    return;
  }
  res.statusCode = 403;
  res.end();
});
server.on('error', (e) => process.exit(e.code === 'EADDRINUSE' ? 3 : 1));
server.listen(port, '127.0.0.1', () => writeFileSync(info, JSON.stringify({ app: 'clawd-base', port, pid: process.pid, token, bundle })));
`;

/** A copy of the plugin layout (scripts/start.mjs + dist/server.mjs) in its own directory, like one plugin install. */
function install(name: string): { start: string; bundle: string } {
  const dir = join(tmp, name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  copyFileSync(startScript, join(dir, 'scripts', 'start.mjs'));
  writeFileSync(join(dir, 'dist', 'server.mjs'), FAKE_SERVER);
  return { start: join(dir, 'scripts', 'start.mjs'), bundle: join(dir, 'dist', 'server.mjs') };
}

async function health(port: number): Promise<{ pid: number; bundle: string } | null> {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { pid: number; bundle: string };
  } catch {
    return null;
  }
}

describe('scripts/start.mjs (/dashboard)', () => {
  it('says so at once when another application owns the port', async () => {
    const other = http.createServer((_req, res) => res.end('not clawd base'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const addr = other.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await runStart(['--port', String(port)]);
    other.close();
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Port ${port} is already used by another application`);
    expect(r.ms).toBeLessThan(3000);
  });

  it('fails fast with the "port in use" message when a non-HTTP listener holds the port', async () => {
    // e.g. an OTLP/gRPC collector: it never answers /api/health (worst case: accepts and stays silent),
    // so only the server's exit code 3 tells.
    const sockets = new Set<net.Socket>();
    const raw = net.createServer((s) => sockets.add(s));
    await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()));
    const addr = raw.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const { start } = install('failfast');
    const r = await runStart(['--port', String(port)], { CLAWD_BASE_DATA_DIR: join(tmp, 'failfast-data') }, [], start);
    for (const s of sockets) s.destroy();
    raw.close();
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Port ${port} is already used by another application`);
    expect(r.ms).toBeLessThan(2000);
  });

  it('replaces an outdated packaged server after a plugin update (token from server.json, never by pid)', async () => {
    const port = await freePort();
    const env = { CLAWD_BASE_DATA_DIR: join(tmp, 'update-data') };
    const v1 = install('plugin-v1');
    const v2 = install('plugin-v2');
    const first = await runStart(['--port', String(port)], env, [], v1.start);
    expect(first.out).toContain('Clawd Base server started');
    const h1 = await health(port);
    expect(h1?.bundle).toBe(v1.bundle);
    // Same install again: nothing to do.
    expect((await runStart(['--port', String(port)], env, [], v1.start)).out).toContain('already running');

    const second = await runStart(['--port', String(port)], env, [], v2.start);
    expect(second.code).toBe(0);
    expect(second.out).toContain('Clawd Base server updated and restarted');
    const h2 = await health(port);
    expect(h2?.bundle).toBe(v2.bundle);
    expect(h2?.pid).not.toBe(h1?.pid);
    expect(JSON.parse(readFileSync(join(env.CLAWD_BASE_DATA_DIR, 'server.json'), 'utf8'))).toMatchObject({ pid: h2?.pid });

    // Without a usable token (no server.json): keep today's behaviour.
    rmSync(join(env.CLAWD_BASE_DATA_DIR, 'server.json'));
    const third = await runStart(['--port', String(port)], env, [], v1.start);
    expect(third.out).toContain('already running');
    expect((await health(port))?.pid).toBe(h2?.pid);
  });

  it('refuses an old Node.js with a clear message', async () => {
    const preload = 'data:text/javascript,' + encodeURIComponent("Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.11.1' } });");
    const r = await runStart(['--port', '9'], {}, ['--import', preload]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('needs Node.js 22.13 or newer (current: 20.11.1)');
  });
});

describe('hooks/hooks.json', () => {
  it('never lets a hook fail, even without Node.js on the PATH', async () => {
    const cfg = JSON.parse(readFileSync(hooksJson, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const commands = Object.values(cfg.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
    expect(commands.length).toBeGreaterThanOrEqual(16);
    for (const c of commands) expect(c.trim().endsWith('|| true')).toBe(true);
  });
});
