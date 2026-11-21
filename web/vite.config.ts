import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev: the server runs on :8000 (`make dev`); /api and /ws are proxied so the page uses one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  // Two HTML entries: the box serves the build as static files (deploy/demo_app.py), so /simulador/ needs
  // its own index.html. Both load the same bundle; main.tsx picks the page from the path.
  build: { rollupOptions: { input: { main: 'index.html', simulador: 'simulador/index.html' } } },
  test: { environment: 'node' },
});
