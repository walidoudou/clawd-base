import { StateStore, type NormalizedEvent } from '@dash/shared';
import { loadConfig } from './config.ts';
import { Ingest } from './ingest.ts';
import { EventLog } from './persist.ts';
import { SseHub } from './sse.ts';
import { TranscriptWatcher } from './watcher.ts';
import { buildApp } from './app.ts';
import { DemoRunner } from './demo.ts';

function logErr(msg: string): void {
  process.stderr.write(`[clawd-base] ${msg}\n`);
}

// Last-resort safety net: log, never crash the dashboard (hooks would silently go nowhere).
process.on('unhandledRejection', (e) => logErr(`unhandledRejection: ${String(e instanceof Error ? e.stack : e)}`));
process.on('uncaughtException', (e) => logErr(`uncaughtException: ${String(e.stack ?? e)}`));

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new StateStore();
  const eventLog = config.persist ? await EventLog.open(config.dataDir, logErr) : null;
  const ingest = new Ingest(store, eventLog);
  const hub = new SseHub(store);
  let watcher: TranscriptWatcher | null = null;
  const demo = new DemoRunner(
    {
      hook: (payload) => ingest.handleHook(payload),
      events: async (evs) => ingest.applyEphemeral(evs),
    },
    logErr,
  );

  const app = buildApp({
    config,
    store,
    ingest,
    hub,
    demo,
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
  hub.start();
  process.stdout.write(`[clawd-base] http://${config.host}:${config.port}  (debug: /debug)\n`);

  // Replay persisted hook events (last N hours), then transcripts.
  if (eventLog) {
    eventLog.forEachSince(Date.now() - config.maxAgeHours * 3600 * 1000, (e: NormalizedEvent) => store.apply(e));
  }
  watcher = new TranscriptWatcher(config.projectsDir, config.maxAgeHours * 3600 * 1000, (evs) => ingest.applyTranscript(evs), logErr);
  await watcher.start();
  store.tick();
  process.stdout.write(`[clawd-base] ${store.sessions.size} session(s) chargée(s), ${watcher.trackedFiles} transcript(s) suivis\n`);

  const tick = setInterval(() => store.tick(), 5000);
  const purge = setInterval(() => eventLog?.purge(), 6 * 3600 * 1000);

  const shutdown = async (): Promise<void> => {
    demo.stop();
    clearInterval(tick);
    clearInterval(purge);
    hub.stop();
    await watcher?.stop();
    eventLog?.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e: unknown) => {
  logErr(String(e instanceof Error ? e.stack : e));
  process.exit(1);
});
