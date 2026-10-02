import { describe, expect, it } from 'vitest';
import { GestureInterpreter, mapToCanvas, pinchRatio, LM } from './gestureInterpreter.js';

/**
 * Builds a synthetic 21-point hand. `pinch` is the thumb–index gap as a
 * fraction of palm length; (cx, cy) positions the wrist; `size` scales it.
 */
function hand({ cx = 0.5, cy = 0.7, size = 0.2, pinch = 1.0 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[LM.WRIST] = { x: cx, y: cy, z: 0 };
  lm[LM.MIDDLE_MCP] = { x: cx, y: cy - size, z: 0 };
  lm[LM.INDEX_MCP] = { x: cx - size * 0.3, y: cy - size * 0.95, z: 0 };
  lm[LM.PINKY_MCP] = { x: cx + size * 0.3, y: cy - size * 0.85, z: 0 };
  const tip = { x: cx - size * 0.2, y: cy - size * 1.6, z: 0 };
  lm[LM.INDEX_TIP] = tip;
  lm[LM.THUMB_TIP] = { x: tip.x - size * pinch, y: tip.y, z: 0 };
  return lm;
}

const ASPECT = 1; // synthetic hands are built in square units

describe('pinchRatio', () => {
  it('is invariant to hand size (distance from camera)', () => {
    const near = pinchRatio(hand({ size: 0.3, pinch: 0.5 }), ASPECT);
    const far = pinchRatio(hand({ size: 0.1, pinch: 0.5 }), ASPECT);
    expect(near).toBeCloseTo(far, 5);
    expect(near).toBeCloseTo(0.5, 2);
  });

  it('corrects for non-square camera frames', () => {
    const lm = hand({ pinch: 0.5 });
    // The same landmarks in a 16:9 frame mean horizontal gaps are physically wider.
    expect(pinchRatio(lm, 16 / 9)).not.toBeCloseTo(pinchRatio(lm, 1), 2);
  });
});

describe('mapToCanvas', () => {
  it('mirrors x for the selfie preview', () => {
    expect(mapToCanvas({ x: 0.2, y: 0.5 }, { mirror: true, activeMargin: 0 }).x).toBeCloseTo(0.8);
    expect(mapToCanvas({ x: 0.2, y: 0.5 }, { mirror: false, activeMargin: 0 }).x).toBeCloseTo(0.2);
  });

  it('expands the active region to the full canvas and clamps', () => {
    const o = { mirror: false, activeMargin: 0.1 };
    expect(mapToCanvas({ x: 0.1, y: 0.9 }, o)).toEqual({ x: 0, y: 1 });
    expect(mapToCanvas({ x: 0.5, y: 0.5 }, o).x).toBeCloseTo(0.5);
    expect(mapToCanvas({ x: -0.3, y: 1.4 }, o)).toEqual({ x: 0, y: 1 });
  });
});

describe('GestureInterpreter pinch hysteresis', () => {
  it('does not flicker when the ratio hovers between the two thresholds', () => {
    const g = new GestureInterpreter({ pinchOn: 0.3, pinchOff: 0.45 });
    let t = 0;
    const events = [];
    const feed = (pinch) => {
      t += 33;
      events.push(...g.update(hand({ pinch }), t, ASPECT).events);
    };
    feed(1.0);
    for (let i = 0; i < 6; i++) feed(0.1); // close the pinch
    expect(g.state.pinching).toBe(true);
    // Hover in the dead band (0.3–0.45) with noise: must stay pinched.
    for (let i = 0; i < 30; i++) feed(i % 2 ? 0.34 : 0.42);
    expect(g.state.pinching).toBe(true);
    for (let i = 0; i < 6; i++) feed(0.9); // open the hand
    expect(g.state.pinching).toBe(false);
    expect(events.filter((e) => e === 'pinchstart')).toHaveLength(1);
    expect(events.filter((e) => e === 'pinchend')).toHaveLength(1);
  });

  it('a single threshold would have flickered on the same signal', () => {
    let state = false;
    let toggles = 0;
    for (let i = 0; i < 30; i++) {
      const r = i % 2 ? 0.34 : 0.42;
      const next = r < 0.38;
      if (next !== state) toggles++;
      state = next;
    }
    expect(toggles).toBeGreaterThan(10);
  });
});

describe('GestureInterpreter tracking loss', () => {
  it('bridges short dropouts within the grace period', () => {
    const g = new GestureInterpreter({ graceMs: 300 });
    g.update(hand({ pinch: 0.05 }), 0, ASPECT);
    g.update(hand({ pinch: 0.05 }), 33, ASPECT);
    expect(g.state.pinching).toBe(true);
    const s1 = g.update(null, 150, ASPECT);
    expect(s1.tracking).toBe('grace');
    expect(s1.present).toBe(true);
    expect(s1.pinching).toBe(true); // still holding the character
    expect(s1.events).toEqual([]);
    const s2 = g.update(hand({ pinch: 0.05 }), 250, ASPECT);
    expect(s2.tracking).toBe('tracked');
    expect(s2.events).not.toContain('found'); // never reported as lost
  });

  it('releases and reports loss after the grace period', () => {
    const g = new GestureInterpreter({ graceMs: 300 });
    g.update(hand({ pinch: 0.05 }), 0, ASPECT);
    g.update(hand({ pinch: 0.05 }), 33, ASPECT);
    g.update(null, 200, ASPECT);
    const s = g.update(null, 400, ASPECT);
    expect(s.tracking).toBe('none');
    expect(s.present).toBe(false);
    expect(s.pinching).toBe(false);
    expect(s.events).toEqual(['pinchend', 'lost']);
    // Next detection is a fresh 'found'.
    expect(g.update(hand(), 500, ASPECT).events).toContain('found');
  });
});

describe('GestureInterpreter smoothing', () => {
  it('reduces fingertip jitter while the hand is still', () => {
    const g = new GestureInterpreter();
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
    const raw = [];
    const smooth = [];
    for (let i = 0; i < 90; i++) {
      const lm = hand();
      const jitter = rand() * 0.02;
      lm[LM.INDEX_TIP] = { ...lm[LM.INDEX_TIP], x: lm[LM.INDEX_TIP].x + jitter };
      const s = g.update(lm, i * 33, ASPECT);
      if (i > 10) {
        raw.push(mapToCanvas(lm[LM.INDEX_TIP]).x);
        smooth.push(s.pointer.x);
      }
    }
    const sd = (a) => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
    };
    expect(sd(smooth)).toBeLessThan(sd(raw) * 0.6);
  });

  it('follows large movements without excessive lag', () => {
    const g = new GestureInterpreter();
    for (let i = 0; i < 10; i++) g.update(hand({ cx: 0.3 }), i * 33, ASPECT);
    let s;
    for (let i = 10; i < 25; i++) s = g.update(hand({ cx: 0.7 }), i * 33, ASPECT);
    const target = mapToCanvas(hand({ cx: 0.7 })[LM.INDEX_TIP]).x;
    expect(Math.abs(s.pointer.x - target)).toBeLessThan(0.02); // within ~0.5 s
  });
});
