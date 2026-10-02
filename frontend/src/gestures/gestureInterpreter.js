import { OneEuroFilter } from './oneEuroFilter.js';

/** MediaPipe hand landmark indices used here. */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
};

export const GESTURE_DEFAULTS = {
  pinchOn: 0.3, // normalised thumb–index distance below which a pinch starts
  pinchOff: 0.45, // ...and above which it ends (hysteresis gap prevents flicker)
  graceMs: 350, // keep the last hand state this long when tracking drops out
  activeMargin: 0.12, // camera border that maps outside the canvas (easier to reach edges)
  mirror: true, // selfie preview: moving your hand right moves the cursor right
  minCutoff: 1.4, // One Euro: smoothing at rest (Hz)
  beta: 0.04, // One Euro: speed coefficient (higher = less lag when moving fast)
};

function dist(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Hand size reference that is stable under hand rotation: the larger of
 * wrist→middle-knuckle and index-knuckle→pinky-knuckle (scaled to similar length).
 */
export function handSize(lm, aspect = 1) {
  const palmLength = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP], aspect);
  const palmWidth = dist(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP], aspect) * 1.25;
  return Math.max(palmLength, palmWidth, 1e-4);
}

/** Thumb-tip to index-tip distance normalised by hand size (scale invariant). */
export function pinchRatio(lm, aspect = 1) {
  return dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP], aspect) / handSize(lm, aspect);
}

/**
 * Map a raw landmark (normalised to the *unmirrored* camera frame) to
 * normalised canvas coordinates [0,1]², handling the mirrored preview and an
 * "active region" so the canvas edges are reachable without leaving the frame.
 */
export function mapToCanvas(p, { mirror = true, activeMargin = 0.12 } = {}) {
  const x = mirror ? 1 - p.x : p.x;
  const span = 1 - 2 * activeMargin;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { x: clamp((x - activeMargin) / span), y: clamp((p.y - activeMargin) / span) };
}

/**
 * Turns per-frame landmarks into a stable interaction state:
 *  - smoothed pointer (index fingertip) and pinch point (thumb/index midpoint)
 *  - pinch detection with separate on/off thresholds
 *  - grace period that bridges brief tracking dropouts
 *  - discrete events: found, lost, pinchstart, pinchend
 */
export class GestureInterpreter {
  constructor(options = {}) {
    this.opts = { ...GESTURE_DEFAULTS, ...options };
    const f = () => new OneEuroFilter({ minCutoff: this.opts.minCutoff, beta: this.opts.beta });
    this.filters = { px: f(), py: f(), gx: f(), gy: f() };
    this.reset();
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
  }

  reset() {
    Object.values(this.filters).forEach((fl) => fl.reset());
    this.present = false;
    this.pinching = false;
    this.lastSeen = -Infinity;
    this.ratioEma = null;
    this.state = this._snapshot('none', []);
  }

  _snapshot(tracking, events) {
    return {
      present: this.present,
      tracking, // none | tracked | grace
      pointer: this.pointer ?? null, // index fingertip, canvas-normalised
      pinchPoint: this.pinchPoint ?? null, // thumb/index midpoint, canvas-normalised
      pinchRatio: this.ratioEma,
      pinching: this.pinching,
      events,
    };
  }

  /**
   * @param landmarks array of 21 {x,y,z} (normalised to the camera frame) or null
   * @param tMs       frame timestamp in ms
   * @param aspect    camera width / height (so distances are not distorted)
   */
  update(landmarks, tMs, aspect = 4 / 3) {
    const events = [];
    if (landmarks && landmarks.length >= 21) {
      if (!this.present) events.push('found');
      this.present = true;
      this.lastSeen = tMs;

      const tip = mapToCanvas(landmarks[LM.INDEX_TIP], this.opts);
      const thumb = mapToCanvas(landmarks[LM.THUMB_TIP], this.opts);
      this.pointer = { x: this.filters.px.filter(tip.x, tMs), y: this.filters.py.filter(tip.y, tMs) };
      this.pinchPoint = {
        x: this.filters.gx.filter((tip.x + thumb.x) / 2, tMs),
        y: this.filters.gy.filter((tip.y + thumb.y) / 2, tMs),
      };

      // Light EMA on the ratio, then hysteresis.
      const r = pinchRatio(landmarks, aspect);
      this.ratioEma = this.ratioEma === null ? r : this.ratioEma + 0.5 * (r - this.ratioEma);
      if (!this.pinching && this.ratioEma < this.opts.pinchOn) {
        this.pinching = true;
        events.push('pinchstart');
      } else if (this.pinching && this.ratioEma > this.opts.pinchOff) {
        this.pinching = false;
        events.push('pinchend');
      }
      this.state = this._snapshot('tracked', events);
      return this.state;
    }

    // No hand this frame.
    if (this.present && tMs - this.lastSeen <= this.opts.graceMs) {
      this.state = this._snapshot('grace', events); // hold last pose
      return this.state;
    }
    if (this.present) {
      if (this.pinching) events.push('pinchend');
      events.push('lost');
      this.pinching = false;
      this.present = false;
      this.ratioEma = null;
      Object.values(this.filters).forEach((fl) => fl.reset());
    }
    this.state = this._snapshot('none', events);
    return this.state;
  }
}
