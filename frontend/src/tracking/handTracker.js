import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const LOCAL_WASM = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}models/hand_landmarker.task`;
// eslint-disable-next-line no-undef
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Human-readable camera errors. */
export function describeCameraError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was blocked. Allow the camera from the icon in your browser’s address bar and try again — or keep using your mouse or finger, which always work.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found. Connect a webcam, or use mouse/touch controls instead.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The camera is busy in another app or tab. Close it there and try again.';
  if (!navigator.mediaDevices?.getUserMedia)
    return 'This browser cannot access the camera here. Use Chrome, Edge or Firefox on http://localhost or HTTPS.';
  return `Could not start the camera (${err?.message || name || 'unknown error'}).`;
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html'); // dev servers answer 404s with index.html
  } catch {
    return false;
  }
}

let assetsPromise = null;
const landmarkers = new Map(); // delegate -> Promise

/** Resolves the WASM fileset + model path once: local assets first, CDN as fallback. */
function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const localOk = (await exists(`${LOCAL_WASM}/vision_wasm_internal.wasm`)) && (await exists(LOCAL_MODEL));
      const fileset = await FilesetResolver.forVisionTasks(localOk ? LOCAL_WASM : CDN_WASM);
      return { fileset, modelPath: localOk ? LOCAL_MODEL : CDN_MODEL, source: localOk ? 'local' : 'cdn' };
    })().catch((err) => {
      assetsPromise = null; // allow retry
      throw err;
    });
  }
  return assetsPromise;
}

/** Loads (and caches) a Hand Landmarker. 'GPU' falls back to 'CPU' if WebGL is unavailable. */
export function loadHandLandmarker(preferred = 'GPU') {
  if (!landmarkers.has(preferred)) {
    const p = (async () => {
      const { fileset, modelPath, source } = await loadAssets();
      const make = (delegate) =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelPath, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      if (preferred === 'CPU') return { landmarker: await make('CPU'), delegate: 'CPU', source };
      try {
        return { landmarker: await make('GPU'), delegate: 'GPU', source };
      } catch (err) {
        console.warn('[SketchMotion] GPU delegate unavailable, using CPU', err);
        return { landmarker: await make('CPU'), delegate: 'CPU', source };
      }
    })().catch((err) => {
      landmarkers.delete(preferred);
      throw err;
    });
    landmarkers.set(preferred, p);
  }
  return landmarkers.get(preferred);
}

// If "GPU" inference is this slow after warm-up, WebGL is software-emulated:
// the CPU (XNNPACK) delegate is then much faster and keeps the UI responsive.
const SLOW_GPU_MS = 60;
const WARMUP_FRAMES = 20;
let preferredDelegate = 'GPU'; // becomes 'CPU' once GPU proved too slow on this device

/**
 * Owns the webcam stream and the per-frame inference loop.
 * - Camera starts only from an explicit user action (start()).
 * - One inference per *new* video frame (requestVideoFrameCallback), and
 *   detectForVideo is synchronous, so calls can never overlap.
 * - stop() cancels the loop and releases the camera tracks.
 */
export class HandTracker {
  constructor({ onFrame, onPerf } = {}) {
    this.onFrame = onFrame ?? (() => {});
    this.onPerf = onPerf ?? (() => {});
    this.video = null;
    this.stream = null;
    this.running = false;
    this.handle = null;
    this.lastTs = -1;
    this.lastVideoTime = -1;
    this.perf = { inferMs: 0, fps: 0, delegate: '', source: '' };
  }

  async start(video) {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('getUserMedia unavailable');
      e.name = 'NotSupportedError';
      throw e;
    }
    // Camera first, so the permission prompt appears right after the click.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
      audio: false,
    });
    this.stream = stream;
    this.video = video;
    try {
      const { landmarker, delegate, source } = await loadHandLandmarker(preferredDelegate);
      this.frames = 0;
      this.switching = false;
      this.landmarker = landmarker;
      this.perf.delegate = delegate;
      this.perf.source = source;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
    } catch (err) {
      this.stop(); // never leave the camera on after a failure
      throw err;
    }
    this.running = true;
    this.useRaf = !video.requestVideoFrameCallback;
    this.lastFrameAt = this.lastTickAt = performance.now();
    this._schedule();
    // Watchdog: some browsers occasionally stop delivering video-frame
    // callbacks; if the loop stalls, resume playback and fall back to rAF.
    this.watchdog = setInterval(() => {
      if (!this.running || performance.now() - this.lastTickAt < 1500) return;
      console.warn('[SketchMotion] video frame loop stalled — restarting with requestAnimationFrame');
      if (this.video.paused) this.video.play().catch(() => {});
      this._cancelLoop();
      this.useRaf = true;
      this._schedule();
    }, 1000);
  }

  _schedule() {
    if (!this.running) return;
    const id = (this.loopId = (this.loopId ?? 0) + 1); // stale callbacks are ignored
    const cb = () => this._tick(id);
    this.handle = this.useRaf
      ? { type: 'raf', id: requestAnimationFrame(cb) }
      : { type: 'vfc', id: this.video.requestVideoFrameCallback(cb) };
  }

  _cancelLoop() {
    if (!this.handle) return;
    if (this.handle.type === 'vfc') this.video?.cancelVideoFrameCallback?.(this.handle.id);
    else cancelAnimationFrame(this.handle.id);
    this.handle = null;
  }

  _tick(id) {
    if (!this.running || id !== this.loopId) return;
    this.lastTickAt = performance.now();
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime && v.videoWidth > 0) {
      this.lastVideoTime = v.currentTime;
      let ts = performance.now();
      if (ts <= this.lastTs) ts = this.lastTs + 1; // MediaPipe needs strictly increasing timestamps
      this.lastTs = ts;
      const t0 = performance.now();
      let result = null;
      try {
        result = this.landmarker.detectForVideo(v, ts);
      } catch (err) {
        console.error('[SketchMotion] hand inference failed', err);
      }
      const t1 = performance.now();
      this.frames = (this.frames ?? 0) + 1;
      const ema = (prev, v) => (this.frames <= 2 ? v : prev + (v - prev) * 0.1);
      if (this.frames > 1) this.perf.inferMs = ema(this.perf.inferMs, t1 - t0); // skip first-frame warm-up
      const frameDt = t1 - this.lastFrameAt;
      this.lastFrameAt = t1;
      if (frameDt > 0) this.perf.fps = ema(this.perf.fps, 1000 / frameDt);
      this._maybeSwitchToCpu();
      const landmarks = result?.landmarks?.[0] ?? null;
      this.onFrame(landmarks, ts, v.videoWidth / v.videoHeight, result);
      this.onPerf(this.perf);
    }
    this._schedule();
  }

  _maybeSwitchToCpu() {
    if (this.perf.delegate !== 'GPU' || this.switching || this.frames < WARMUP_FRAMES || this.perf.inferMs < SLOW_GPU_MS) return;
    this.switching = true;
    console.info(`[SketchMotion] GPU inference averages ${this.perf.inferMs.toFixed(0)} ms — switching to the CPU delegate`);
    loadHandLandmarker('CPU')
      .then(({ landmarker }) => {
        preferredDelegate = 'CPU';
        this.landmarker = landmarker;
        this.perf.delegate = 'CPU (auto)';
        this.frames = 1; // restart the averages for the new delegate
      })
      .catch((err) => console.warn('[SketchMotion] CPU delegate failed, staying on GPU', err));
  }

  stop() {
    this.running = false;
    clearInterval(this.watchdog);
    this._cancelLoop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.lastVideoTime = -1;
  }
}
