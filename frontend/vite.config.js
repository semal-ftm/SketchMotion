import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to FastAPI so the browser only ever talks to one origin.
const API_TARGET = process.env.SKETCHMOTION_API ?? 'http://127.0.0.1:8000';
// Used to build the CDN fallback URL for the MediaPipe WASM runtime.
const MEDIAPIPE_VERSION = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url)),
).version;

export default defineConfig({
  plugins: [react()],
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(MEDIAPIPE_VERSION) },
  server: {
    port: 5173,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
