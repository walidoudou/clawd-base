# Contributing

Thanks for your interest! Clawd Base is a small TypeScript monorepo:

- `packages/shared` — pure logic (types, transcript parser, hook adapter, diffs, workflow detection, idempotent store, sprites and mascot generator). Everything here is unit-tested.
- `packages/server` — Fastify server, transcript watcher, SSE, persistence, guided demo.
- `packages/web` — React UI + PixiJS scene. UI strings live in `src/i18n/{fr,en}.ts` (keep both in sync; the `Strings` type enforces it).
- `scripts/` — hook (`send-event.mjs`), start script, simulator, build helpers.

## Workflow

```bash
npm install
npm run dev:server   # server with hot reload
npm run dev:web      # UI on http://127.0.0.1:5173 (proxies /api)
npm run simulate     # guided demo against the running server
npm test && npm run typecheck
npm run build        # rebuilds dist/ — commit it: the installed plugin runs from dist/
```

## Guidelines

- TypeScript strict everywhere; no `any`.
- The hook script must never block or fail Claude Code (always exit 0, no stdout).
- Nothing may leave the machine: no external requests, no CDN, no telemetry.
- Keep the store reducer idempotent: the same fact from a hook and a transcript line must count once.
- When Claude Code formats change, update `docs/FINDINGS.md` with what you verified and add a test with a fixture.
- Add tests for new behaviour; CI runs typecheck, tests and checks that `dist/` is up to date.
