import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Page paths of the client router (src/router.ts). The demo server serves real files only (D-015,
// deploy/demo_app.py), so the build writes each page's index.html where a reload will look for it.
const PAGES = ['supervisor'];

function pageCopies(): Plugin {
  return {
    name: 'page-copies',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') this.error('index.html is missing from the build');
      for (const page of PAGES) this.emitFile({ type: 'asset', fileName: `${page}/index.html`, source: html.source });
    },
  };
}

// Dev: the server runs on :8000 (`make dev`); /api and /ws are proxied so the page uses one origin.
export default defineConfig({
  plugins: [react(), pageCopies()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  test: { environment: 'node' },
});
