// Copies the MediaPipe Tasks WASM runtime into /public and downloads the
// Hand Landmarker model once, so hand tracking runs fully locally/offline.
// Never fails the install: if anything is missing, the app falls back to the
// official CDN URLs at runtime (see src/tracking/handTracker.js).
import { existsSync, mkdirSync, cpSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelDst = join(root, 'public', 'models', 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function log(msg) {
  console.log(`[setup-mediapipe] ${msg}`);
}

try {
  if (existsSync(wasmSrc)) {
    mkdirSync(wasmDst, { recursive: true });
    cpSync(wasmSrc, wasmDst, { recursive: true });
    log('Copied MediaPipe WASM runtime to public/mediapipe/wasm');
  } else {
    log('WARNING: @mediapipe/tasks-vision not installed yet; WASM will load from CDN.');
  }
} catch (err) {
  log(`WARNING: could not copy WASM (${err.message}); CDN fallback will be used.`);
}

try {
  if (existsSync(modelDst) && statSync(modelDst).size > 1_000_000) {
    log('Hand Landmarker model already present.');
  } else {
    log('Downloading Hand Landmarker model (~7.5 MB)...');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(modelDst), { recursive: true });
    writeFileSync(modelDst, buf);
    log(`Saved model to public/models/hand_landmarker.task (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
} catch (err) {
  log(`WARNING: model download failed (${err.message}); the app will fetch it from the CDN at runtime.`);
}
