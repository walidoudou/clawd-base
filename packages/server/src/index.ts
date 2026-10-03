import { fileURLToPath } from 'node:url';
import { StateStore, type NormalizedEvent } from '@dash/shared';
import { APP_ID, loadConfig } from './config.ts';
import { Ingest } from './ingest.ts';
import { EventLog } from './persist.ts';
import { SseHub } from './sse.ts';
import { TranscriptWatcher } from './watcher.ts';
import { buildApp } from './app.ts';
import { DemoRunner } from './demo.ts';
import { ensurePrivateDir, newToken, removeServerInfo, writeServerInfo } from './runtime.ts';

function logErr(msg: string): void {
  process.stderr.write(`[clawd-base] ${msg}\n`);
}

// Last-resort safety net: log, never crash the dashboard (hooks would silently go nowhere).
process.on('unhandledRejection', (e) => logErr(`unhandledRejection: ${String(e instanceof Error ? e.stack : e)}`));
process.on('uncaughtException', (e) => logErr(`uncaughtException: ${String(e.stack ?? e)}`));

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new StateStore();
  const ingest = new Ingest(store, null);
  if (config.persist) ingest.deferLog();
  const hub = new SseHub(store);
  const token = newToken();
  // The bundle itself once packaged (dist/server.mjs), src/index.ts under tsx.
  const bundle = fileURLToPath(import.meta.url);
  let eventLog: EventLog | null = null;
  let watcher: TranscriptWatcher | null = null;
  let tick: NodeJS.Timeout | undefined;
  let purge: NodeJS.Timeout | undefined;
  let infoWritten = false;
  const demo = new DemoRunner(
    {
      hook: (payload) => ingest.handleHook(payload),
      events: async (evs) => ingest.applyEphemeral(evs),
    },
    logErr,
  );

  const dropServerInfo = (): void => {
    if (!infoWritten) return;
    infoWritten = false;
    removeServerInfo(config.dataDir);
  };
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), 3000).unref(); // never hang on a stuck connection
    // Release server.json while we still hold the port: a successor can only write its own after we close it.
    dropServerInfo();
    demo.stop();
    clearInterval(tick);
    clearInterval(purge);
    hub.stop();
    await watcher?.stop();
    await app.close();
    eventLog?.close();
    process.exit(0);
  };

  const app = buildApp({
    config,
    store,
    ingest,
    hub,
    demo,
    token,
    bundle,
    shutdown: () => void shutdown(),
    stats: () => ({
      sessions: store.sessions.size,
      agents: store.agents.size,
      hooks: ingest.hookCount,
      transcriptEvents: ingest.transcriptEventCount,
      trackedFiles: watcher?.trackedFiles ?? 0,
      clients: hub.clientCount,
      persist: eventLog?.enabled ?? false,
    }),
  });

  // Listen first so hooks are accepted immediately; the initial scan follows.
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logErr(`port ${config.port} déjà utilisé — un serveur tourne peut-être déjà.`);
      process.exit(3);
    }
    throw e;
  }
  // From here on we own the port: it is the mutex between concurrent starts, so only now do we touch
  // the data dir (server.json, events.db). Losers exit above without having opened anything.
  const bound = app.server.address();
  if (bound && typeof bound === 'object') config.port = bound.port; // --port 0
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('exit', dropServerInfo);
  try {
    ensurePrivateDir(config.dataDir);
    writeServerInfo(config.dataDir, { app: APP_ID, port: config.port, pid: process.pid, token, bundle, startedAt: new Date().toISOString() });
    infoWritten = true;
  } catch (e) {
    // Hooks still work, without the token: no file snapshots, diffs from the payloads only.
    logErr(`server.json non écrit: ${String(e)}`);
  }
  hub.start();
  process.stdout.write(`[clawd-base] http://${config.host}:${config.port}  (debug: /debug)\n`);

  // Replay persisted hook events (last N hours), then transcripts.
  if (config.persist) {
    eventLog = await EventLog.open(config.dataDir, logErr);
    eventLog.forEachSince(Date.now() - config.maxAgeHours * 3600 * 1000, (e: NormalizedEvent) => store.apply(e));
    // Hooks received since listen are already in the store; persist them now (after the replay, so they are not applied twice).
    ingest.attachLog(eventLog);
  }
  if (stopping) return;
  watcher = new TranscriptWatcher(config.projectsDir, config.maxAgeHours * 3600 * 1000, (evs) => ingest.applyTranscript(evs), logErr);
  await watcher.start();
  store.tick();
  process.stdout.write(`[clawd-base] ${store.sessions.size} session(s) chargée(s), ${watcher.trackedFiles} transcript(s) suivis\n`);

  tick = setInterval(() => store.tick(), 5000);
  purge = setInterval(() => eventLog?.purge(), 6 * 3600 * 1000);
}

main().catch((e: unknown) => {
  logErr(String(e instanceof Error ? e.stack : e));
  process.exit(1);
});
