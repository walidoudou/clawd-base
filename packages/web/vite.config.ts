import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.CLAWD_BASE_PORT || process.env.CLAUDE_DASH_PORT) || 4317;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@dash/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } },
  },
});
