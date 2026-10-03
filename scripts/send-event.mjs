#!/usr/bin/env node
// Claude Code hook → local dashboard server.
// Contract: never block, never fail, never print. Always exits 0, even if the server is down.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = process.env.CLAWD_BASE_DATA_DIR || process.env.CLAUDE_DASH_DATA_DIR || join(homedir(), '.clawd-base');

/**
 * <data dir>/server.json, written by the running server once it owns its port: the exact port, and a
 * per-run token proving this request comes from the user who started it (the server then trusts it
 * with file snapshots). The data dir is owner-only, so other local accounts cannot read it.
 */
function serverInfo() {
  try {
    const j = JSON.parse(readFileSync(join(DATA_DIR, 'server.json'), 'utf8'));
    const port = Number(j && j.port);
    if (j.app === 'clawd-base' && Number.isInteger(port) && port > 0 && port < 65536) {
      return { port, token: typeof j.token === 'string' && /^[0-9a-f]{16,256}$/i.test(j.token) ? j.token : null };
    }
  } catch {
    /* no server running (or an older one): fall back to the configured port, without a token */
  }
  return null;
}

/** Same port resolution as the server: env, then <data dir>/config.json, then 4317. */
function resolvePort() {
  const env = Number(process.env.CLAWD_BASE_PORT || process.env.CLAUDE_DASH_PORT);
  if (env) return env;
  try {
    const port = Number(JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8')).port);
    if (port) return port;
  } catch {
    /* no config */
  }
  return 4317;
}
const INFO = serverInfo();
const PORT = INFO ? INFO.port : resolvePort();
const HARD_DEADLINE_MS = 1500;
const REQUEST_TIMEOUT_MS = 800;

const done = () => process.exit(0);
setTimeout(done, HARD_DEADLINE_MS).unref();
process.on('uncaughtException', done);
process.on('unhandledRejection', done);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; if (raw.length > 8 * 1024 * 1024) done(); });
process.stdin.on('error', done);
process.stdin.on('end', () => {
  if (!raw.trim()) return done();
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) };
  if (INFO && INFO.token) headers['X-Clawd-Token'] = INFO.token;
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/api/hook', method: 'POST', timeout: REQUEST_TIMEOUT_MS, headers },
    (res) => { res.resume(); res.on('end', done); res.on('error', done); },
  );
  req.on('timeout', () => { req.destroy(); done(); });
  req.on('error', done);
  req.end(raw);
});
