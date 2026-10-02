import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { DashConfig, NormalizedEvent, StateStore } from '@dash/shared';
import { APP_ID, type ServerConfig } from './config.ts';
import type { Ingest } from './ingest.ts';
import type { SseHub } from './sse.ts';
import type { DemoRunner } from './demo.ts';
import { DEBUG_HTML } from './debugPage.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export interface AppDeps {
  config: ServerConfig;
  store: StateStore;
  ingest: Ingest;
  hub: SseHub;
  stats: () => Record<string, unknown>;
  demo?: DemoRunner;
}

function isLocalHost(req: FastifyRequest, port: number): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function isLocalOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin);
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, store, ingest, hub } = deps;
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  // DNS-rebinding / CSRF guard: only local Host headers, only local Origins.
  app.addHook('onRequest', async (req, reply) => {
    if (!isLocalHost(req, config.port)) return reply.code(403).send('forbidden');
    if (req.method !== 'GET' && !isLocalOrigin(req.headers.origin, config.port)) return reply.code(403).send('forbidden');
  });

  app.get('/api/health', async () => ({ ok: true, app: APP_ID, version: config.version, pid: process.pid, port: config.port, ...deps.stats() }));

  app.get('/api/config', async (): Promise<DashConfig> => ({ spriteSet: config.spriteSet, locale: config.locale, version: config.version }));

  app.get('/api/state', async () => store.snapshot());

  app.post('/api/hook', async (req, reply) => {
    try {
      await ingest.handleHook(req.body);
    } catch {
      // Never fail the hook.
    }
    return reply.code(204).send();
  });

  /** Used by the simulator to inject normalized events directly. */
  app.post('/api/events', async (req, reply) => {
    const body = req.body;
    const events = Array.isArray(body) ? (body as NormalizedEvent[]) : [];
    ingest.applyEphemeral(events.filter((e) => e && typeof e === 'object' && typeof e.kind === 'string' && typeof e.sessionId === 'string'));
    return reply.code(204).send();
  });

  // Guided demo (the "▶ Démo" button).
  app.get('/api/demo', async () => deps.demo?.status ?? { running: false, paused: false, sessionId: null, speed: 1 });
  app.post('/api/demo/start', async (req, reply) => {
    if (!deps.demo) return reply.code(404).send();
    const body = (req.body ?? {}) as { speed?: unknown; locale?: unknown };
    const sessionId = await deps.demo.start(typeof body.speed === 'number' ? body.speed : 1, body.locale === 'en' ? 'en' : 'fr');
    return { sessionId };
  });
  app.post('/api/demo/stop', async (_req, reply) => {
    deps.demo?.stop();
    return reply.code(204).send();
  });
  app.post('/api/demo/pause', async (req, reply) => {
    const body = (req.body ?? {}) as { paused?: unknown };
    deps.demo?.setPaused(body.paused === true);
    return reply.code(204).send();
  });
  app.post('/api/demo/speed', async (req, reply) => {
    const body = (req.body ?? {}) as { speed?: unknown };
    if (typeof body.speed === 'number') deps.demo?.setSpeed(body.speed);
    return reply.code(204).send();
  });

  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const last = req.headers['last-event-id'];
    hub.attach(reply.raw, typeof last === 'string' ? last : undefined);
  });

  app.get('/debug', async (_req, reply) => reply.type('text/html; charset=utf-8').send(DEBUG_HTML));

  // Static web app (built by Vite into dist/web).
  app.get('/*', async (req, reply) => {
    if (!config.webDir) {
      return reply
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><title>Clawd Base</title><body style="background:#14111a;color:#eee;font-family:monospace;padding:2rem">Interface non construite. Lancez <code>npm run build</code>. Page de debug : <a style="color:#f0a" href="/debug">/debug</a></body>');
    }
    const url = (req.params as { '*': string })['*'] || 'index.html';
    const safe = normalize(decodeURIComponent(url.split('?')[0] ?? '')).replace(/^(\.\.(\/|\\|$))+/, '');
    let file = join(config.webDir, safe);
    if (!file.startsWith(config.webDir + sep) && file !== config.webDir) return reply.code(404).send();
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(config.webDir, 'index.html'); // SPA fallback
    }
    try {
      const data = await readFile(file);
      const type = MIME[extname(file)] ?? 'application/octet-stream';
      const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      return reply.header('Cache-Control', cache).type(type).send(data);
    } catch {
      return reply.code(404).send();
    }
  });

  return app;
}
