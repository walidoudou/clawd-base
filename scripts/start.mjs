#!/usr/bin/env node
// Start the Clawd Base server if it is not running, then open the dashboard.
//   node scripts/start.mjs [--no-open] [--port 4317]
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(root, 'dist', 'server.mjs');
const dataDir = process.env.CLAWD_BASE_DATA_DIR || process.env.CLAUDE_DASH_DATA_DIR || join(homedir(), '.clawd-base');
function configPort() {
  try {
    return Number(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')).port) || 0;
  } catch {
    return 0;
  }
}
// Same resolution order as the server and the hook: --port, env, config.json, 4317.
const PORT = Number(portArg >= 0 ? args[portArg + 1] : 0) || Number(process.env.CLAWD_BASE_PORT || process.env.CLAUDE_DASH_PORT) || configPort() || 4317;
const URL_ = `http://127.0.0.1:${PORT}/`;
const FR = (process.env.LANG || process.env.LC_ALL || '').toLowerCase().startsWith('fr');
const msg = {
  notBuilt: (p) => (FR ? `Serveur non construit (${p} introuvable). Lancez « npm install && npm run build » dans ${root}.` : `Server not built (${p} missing). Run "npm install && npm run build" in ${root}.`),
  failed: (log) => (FR ? `Le serveur n'a pas démarré. Journal : ${log}` : `The server did not start. Log: ${log}`),
  started: (pid) => (FR ? `Serveur Clawd Base démarré (pid ${pid}).` : `Clawd Base server started (pid ${pid}).`),
  updated: (pid) => (FR ? `Serveur Clawd Base mis à jour et redémarré (pid ${pid}).` : `Clawd Base server updated and restarted (pid ${pid}).`),
  running: (pid) => (FR ? `Serveur Clawd Base déjà actif (pid ${pid}).` : `Clawd Base server already running (pid ${pid}).`),
  url: (u) => (FR ? `Tableau de bord : ${u}` : `Dashboard: ${u}`),
  busy: (p) => (FR ? `Le port ${p} est déjà utilisé par une autre application. Choisissez-en un autre : ajoutez "CLAWD_BASE_PORT": "4318" dans le bloc "env" de ~/.claude/settings.json, puis redémarrez Claude Code.` : `Port ${p} is already used by another application. Pick another one: add "CLAWD_BASE_PORT": "4318" to the "env" block of ~/.claude/settings.json, then restart Claude Code.`),
  node: (v) => (FR ? `Clawd Base nécessite Node.js 22.13 ou plus récent (version actuelle : ${v}). Installez-le depuis https://nodejs.org puis relancez.` : `Clawd Base needs Node.js 22.13 or newer (current: ${v}). Install it from https://nodejs.org and try again.`),
};

// The server uses the built-in node:sqlite (Node 22.13+). Older versions get a clear message instead of a crash.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(msg.node(process.versions.node));
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Our server's health, or null. `other` is set when something else answers on the port. */
let other = false;
async function health(timeoutMs = 800) {
  let r;
  try {
    r = await fetch(`${URL_}api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null; // nothing listening
  }
  try {
    const j = await r.json();
    if (j && j.app === 'clawd-base') return j;
  } catch {
    /* not JSON */
  }
  other = true;
  return null;
}

/** A packaged server (dist/server.mjs, not a dev `tsx` one) from another install: the version before a plugin update. */
function outdated(h) {
  if (typeof h.bundle !== 'string' || !h.bundle.replace(/\\/g, '/').endsWith('dist/server.mjs')) return false;
  const norm = (p) => {
    let full = resolve(p);
    try {
      full = realpathSync(full); // the old install may be gone already
    } catch {
      /* keep the resolved path */
    }
    return platform() === 'win32' ? full.toLowerCase() : full;
  };
  return norm(h.bundle) !== norm(BUNDLE);
}

/** Token from <data dir>/server.json, only if that file describes the server answering on PORT. */
function serverToken(h) {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8'));
    if (j && j.app === 'clawd-base' && j.pid === h.pid && Number(j.port) === PORT && typeof j.token === 'string') return j.token;
  } catch {
    /* no server.json (older server, other user, other data dir) */
  }
  return null;
}

/** True when nothing accepts connections on PORT. */
function portFree() {
  return new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port: PORT });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); res(false); });
    s.once('timeout', () => { s.destroy(); res(false); });
    s.once('error', () => res(true));
  });
}

/** Ask the server to exit (authenticated, never by pid), then wait up to ~5 s for its port. */
async function stopServer(token) {
  try {
    const r = await fetch(`${URL_}api/shutdown`, { method: 'POST', headers: { 'X-Clawd-Token': token }, signal: AbortSignal.timeout(2000) });
    if (r.status !== 202) return false;
  } catch {
    return false;
  }
  for (let i = 0; i < 25; i++) {
    if (await portFree()) return true;
    await sleep(200);
  }
  return false;
}

function openBrowser(url) {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const cmdArgs = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    /* no browser available */
  }
}

let h = await health();
if (!h && other) {
  console.error(msg.busy(PORT));
  process.exit(1);
}
// After a plugin update the old server keeps running from the previous install: replace it.
let updated = false;
if (h && outdated(h)) {
  const token = serverToken(h);
  if (token && (await stopServer(token))) {
    h = null;
    updated = true;
  }
}
if (!h) {
  if (!existsSync(BUNDLE)) {
    console.error(msg.notBuilt(BUNDLE));
    process.exit(1);
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const logFile = join(dataDir, 'server.log');
  const log = openSync(logFile, 'a', 0o600);
  try {
    chmodSync(logFile, 0o600); // created by an older version with the default permissions
  } catch {
    /* not ours, or no POSIX modes */
  }
  const child = spawn(process.execPath, [BUNDLE, '--port', String(PORT)], { detached: true, stdio: ['ignore', log, log], cwd: root, windowsHide: true });
  // If the server dies before answering (port taken, crash), stop waiting at once.
  let exitCode = null;
  const exited = new Promise((r) => {
    child.once('exit', (code) => { exitCode = code ?? -1; r(); });
    child.once('error', () => { exitCode = -1; r(); });
  });
  child.unref();
  for (let i = 0; i < 40 && !h && exitCode === null; i++) {
    await Promise.race([sleep(250), exited]);
    if (exitCode === null) h = await health();
  }
  // Exit code 3 = EADDRINUSE. A concurrent start may have won the port (then our server answers), or
  // something that does not speak HTTP holds it (e.g. an OTLP/gRPC collector on 4317).
  if (!h && exitCode === 3) h = await health(400);
  if (!h) {
    console.error(exitCode === 3 ? msg.busy(PORT) : msg.failed(logFile));
    process.exit(1);
  }
  console.log(updated ? msg.updated(h.pid) : msg.started(h.pid));
} else {
  console.log(msg.running(h.pid));
}
console.log(msg.url(URL_));
if (!args.includes('--no-open')) openBrowser(URL_);
