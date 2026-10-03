/**
 * Simulator — replays a realistic fake Claude Code session against the local server,
 * so the UI can be developed without a live session.
 *
 *   npm run simulate                      # the guided demo (same as the ▶ Démo button), narrated
 *   npm run simulate -- --speed 3         # 3× faster
 *   npm run simulate -- --loop            # restart with a new session when finished
 *   npm run simulate -- --replay <file.jsonl> [--speed 20]   # replay a real transcript (and its sub-agents)
 *
 * Hook payloads go to POST /api/hook (same path as the real plugin); token usage, which
 * real sessions only expose through transcripts, is sent as normalized events to /api/events.
 * Simulated session ids start with "sim-" and are never persisted.
 * If the server's <data dir>/server.json is readable (--data-dir, else the usual resolution), its port is
 * the default and its token is sent, like the real hook script does.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TranscriptParser, eventsFromAgentMeta, type NormalizedEvent } from '../packages/shared/src/index.ts';
import { runGuidedDemo, type DemoTransport } from '../packages/server/src/demo.ts';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DATA_DIR = opt('data-dir') || process.env['CLAWD_BASE_DATA_DIR'] || process.env['CLAUDE_DASH_DATA_DIR'] || join(homedir(), '.clawd-base');

/** Handshake file of the running server (see packages/server/src/runtime.ts). */
function serverInfo(): { port: number; token: string } | null {
  try {
    const j = JSON.parse(readFileSync(join(DATA_DIR, 'server.json'), 'utf8')) as { app?: unknown; port?: unknown; token?: unknown };
    if (j.app === 'clawd-base' && typeof j.port === 'number' && typeof j.token === 'string') return { port: j.port, token: j.token };
  } catch {
    /* no server.json: no token */
  }
  return null;
}
const INFO = serverInfo();
const PORT = Number(opt('port') ?? process.env['CLAWD_BASE_PORT'] ?? process.env['CLAUDE_DASH_PORT'] ?? INFO?.port ?? 4317);
// Only hand the token to the server that wrote it.
const TOKEN = INFO && INFO.port === PORT ? INFO.token : null;
const SPEED = Math.max(0.1, Number(opt('speed') ?? 1));
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / SPEED));

async function post(path: string, body: unknown): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['X-Clawd-Token'] = TOKEN;
    await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    console.error(`[simulate] serveur injoignable sur ${BASE} — lancez d'abord \`npm run dev:server\` ou \`npm start\`.`);
    process.exit(1);
  }
}

// ───────────────────────── guided demo over HTTP ─────────────────────────

const http: DemoTransport = {
  hook: (payload) => post('/api/hook', payload),
  events: (events) => post('/api/events', events),
};

async function scenario(): Promise<void> {
  const ctl = { speed: SPEED, paused: false, aborted: false };
  const lang = opt('lang') === 'en' || (!opt('lang') && !(process.env['LANG'] ?? '').startsWith('fr')) ? 'en' : 'fr';
  const id = await runGuidedDemo(http, ctl, (sid) => console.log(`[simulate] session ${sid}`), lang);
  console.log(`[simulate] démo terminée (${id})`);
}

// ───────────────────────── transcript replay ─────────────────────────

async function replay(file: string): Promise<void> {
  if (!existsSync(file)) throw new Error(`fichier introuvable: ${file}`);
  const realSession = basename(file).replace(/\.jsonl$/, '');
  const sessionId = `sim-replay-${randomUUID().slice(0, 8)}`;
  const parsers: Array<{ parser: TranscriptParser; lines: string[] }> = [{ parser: new TranscriptParser({ sessionId: realSession, agentId: null, path: file }), lines: readFileSync(file, 'utf8').split('\n') }];
  const metaEvents: NormalizedEvent[] = [];
  const subDir = join(dirname(file), realSession, 'subagents');
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir)) {
      const m = /^agent-(.+)\.(jsonl|meta\.json)$/.exec(f);
      if (!m) continue;
      const p = join(subDir, f);
      if (m[2] === 'jsonl') parsers.push({ parser: new TranscriptParser({ sessionId: realSession, agentId: m[1] ?? null }), lines: readFileSync(p, 'utf8').split('\n') });
      else metaEvents.push(...eventsFromAgentMeta(realSession, m[1] as string, JSON.parse(readFileSync(p, 'utf8')), 0));
    }
  }
  const all: NormalizedEvent[] = [];
  for (const { parser, lines } of parsers) for (const l of lines) all.push(...parser.parseLine(l));
  all.sort((a, b) => a.at - b.at);
  if (!all.length) return console.log('[simulate] transcript vide');
  const t0 = all[0]!.at;
  const start = Date.now();
  const remap = (e: NormalizedEvent, at: number): NormalizedEvent => {
    const s = JSON.parse(JSON.stringify(e).split(realSession).join(sessionId)) as NormalizedEvent;
    return { ...s, at, source: 'sim' };
  };
  console.log(`[simulate] replay ${all.length} événements → session ${sessionId} (×${SPEED})`);
  // Meta links first (they only carry linking info).
  let batch: NormalizedEvent[] = metaEvents.map((e) => remap(e, start));
  for (const e of all) {
    const due = start + (e.at - t0) / SPEED;
    const wait = due - Date.now();
    if (wait > 30) {
      if (batch.length) await post('/api/events', batch);
      batch = [];
      await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
    }
    batch.push(remap(e, Math.max(due, Date.now())));
    if (batch.length > 200) {
      await post('/api/events', batch);
      batch = [];
    }
  }
  if (batch.length) await post('/api/events', batch);
  console.log('[simulate] replay terminé');
}

async function main(): Promise<void> {
  const file = opt('replay');
  if (file) return replay(file);
  do {
    await scenario();
    if (argv.includes('--loop')) await sleep(5000);
  } while (argv.includes('--loop'));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
