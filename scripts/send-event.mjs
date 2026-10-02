#!/usr/bin/env node
// Claude Code hook → local dashboard server.
// Contract: never block, never fail, never print. Always exits 0, even if the server is down.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Same port resolution as the server: env, then <data dir>/config.json, then 4317. */
function resolvePort() {
  const env = Number(process.env.CLAWD_BASE_PORT || process.env.CLAUDE_DASH_PORT);
  if (env) return env;
  try {
    const dir = process.env.CLAWD_BASE_DATA_DIR || process.env.CLAUDE_DASH_DATA_DIR || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.clawd-base');
    const port = Number(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).port);
    if (port) return port;
  } catch {
    /* no config */
  }
  return 4317;
}
const PORT = resolvePort();
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
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/api/hook', method: 'POST', timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } },
    (res) => { res.resume(); res.on('end', done); res.on('error', done); },
  );
  req.on('timeout', () => { req.destroy(); done(); });
  req.on('error', done);
  req.end(raw);
});
