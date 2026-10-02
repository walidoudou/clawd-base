#!/usr/bin/env node
// Bundle the server (and its dependencies) into a single dist/server.mjs so the
// installed plugin runs with plain `node`, without `npm install`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  entryPoints: [`${root}packages/server/src/index.ts`],
  outfile: `${root}dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  alias: { '@dash/shared': `${root}packages/shared/src/index.ts` },
  // Some CommonJS dependencies call require(): give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['node:sqlite'],
  logLevel: 'info',
});
