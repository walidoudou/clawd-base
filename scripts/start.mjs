#!/usr/bin/env node
// Start the Clawd Base server if it is not running, then open the dashboard.
//   node scripts/start.mjs [--no-open] [--port 4317]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CLAWD_BASE_DATA_DIR || process.env.CLAUDE_DASH_DATA_DIR || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.clawd-base');
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
  running: (pid) => (FR ? `Serveur Clawd Base déjà actif (pid ${pid}).` : `Clawd Base server already running (pid ${pid}).`),
  url: (u) => (FR ? `Tableau de bord : ${u}` : `Dashboard: ${u}`),
};

async function health() {
  try {
    const r = await fetch(`${URL_}api/health`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    return j && j.app === 'clawd-base' ? j : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const cmdArgs = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no browser available */
  }
}

let h = await health();
if (!h) {
  const bundle = join(root, 'dist', 'server.mjs');
  if (!existsSync(bundle)) {
    console.error(msg.notBuilt(bundle));
    process.exit(1);
  }
  mkdirSync(dataDir, { recursive: true });
  const log = openSync(join(dataDir, 'server.log'), 'a');
  const child = spawn(process.execPath, [bundle, '--port', String(PORT)], { detached: true, stdio: ['ignore', log, log], cwd: root });
  child.unref();
  for (let i = 0; i < 40 && !h; i++) {
    await new Promise((r) => setTimeout(r, 250));
    h = await health();
  }
  if (!h) {
    console.error(msg.failed(join(dataDir, 'server.log')));
    process.exit(1);
  }
  console.log(msg.started(h.pid));
} else {
  console.log(msg.running(h.pid));
}
console.log(msg.url(URL_));
if (!args.includes('--no-open')) openBrowser(URL_);
