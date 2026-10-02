/**
 * Sprite physics: fixed-timestep, frame-rate independent.
 * Pure functions on a plain body object so they can be unit tested.
 *
 * Coordinates are CSS pixels; y grows downward. (x, y) is the sprite centre;
 * (hw, hh) are collision half-extents (already including scale + rotation).
 */

export const PHYSICS = {
  dt: 1 / 120, // fixed simulation step (s)
  maxFrame: 0.1, // clamp long frames (tab switches) to avoid spiralling
  gravity: 2200, // px/s²
  floorRestitution: 0.52,
  wallRestitution: 0.6,
  floorFriction: 5.5, // 1/s exponential decay of horizontal speed on the floor
  airDrag: 0.25, // 1/s
  restSpeed: 70, // below this vertical impact speed, stop bouncing
  maxSpeed: 3200,
  followStiffness: 13, // ω for follow-finger spring (rad/s)
  holdStiffness: 30, // ω while grabbed (tighter)
  squashStiffness: 260, // squash spring k
  squashDamping: 13,
  squashPerSpeed: 0.00016, // squash impulse per px/s of impact speed
};

export function createBody(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    hw: 50, hh: 50,
    squash: 0, squashV: 0, // >0 = flattened (wider/shorter), <0 = stretched
    grounded: false,
    target: null, // {x, y, stiffness} -> spring toward it (follow / held)
    lastImpact: 0, // impact speed of the most recent collision this step
  };
}

/** Advance the body by one fixed step. env: { width, height, floorY, gravityScale } */
export function stepBody(b, dt, env, P = PHYSICS) {
  b.lastImpact = 0;
  if (b.target) {
    // Critically damped spring: smooth, no overshoot, keeps a real velocity so
    // the character can be thrown on release.
    const w = b.target.stiffness;
    b.vx += (w * w * (b.target.x - b.x) - 2 * w * b.vx) * dt;
    b.vy += (w * w * (b.target.y - b.y) - 2 * w * b.vy) * dt;
    b.grounded = false;
  } else {
    if (env.gravityScale > 0) b.vy += P.gravity * env.gravityScale * dt;
    const drag = Math.exp(-P.airDrag * dt);
    b.vx *= drag;
    b.vy *= drag;
  }
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > P.maxSpeed) {
    b.vx *= P.maxSpeed / speed;
    b.vy *= P.maxSpeed / speed;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  collide(b, env, P);

  // Squash spring.
  b.squashV += (-P.squashStiffness * b.squash - P.squashDamping * b.squashV) * dt;
  b.squash = Math.max(-0.22, Math.min(0.3, b.squash + b.squashV * dt));
}

function collide(b, env, P) {
  const floor = env.floorY ?? env.height;
  const left = b.hw;
  const right = env.width - b.hw;
  const top = b.hh;
  const bottom = floor - b.hh;
  const free = !b.target;

  if (b.x < left || b.x > right) {
    b.x = Math.min(Math.max(b.x, left), Math.max(left, right));
    if (free) {
      const impact = Math.abs(b.vx);
      b.vx = -b.vx * P.wallRestitution;
      // Side impact: squeeze horizontally (stretch vertically).
      b.squashV -= impact * P.squashPerSpeed * 6;
      b.lastImpact = Math.max(b.lastImpact, impact);
    } else b.vx = 0;
  }
  if (b.y < top) {
    b.y = top;
    if (free) b.vy = Math.abs(b.vy) * P.wallRestitution;
    else b.vy = 0;
  }
  b.grounded = false;
  if (b.y >= bottom) {
    b.y = bottom;
    if (free) {
      const impact = Math.max(0, b.vy);
      if (impact > P.restSpeed) {
        b.vy = -impact * P.floorRestitution;
        b.squashV += impact * P.squashPerSpeed * 9;
        b.lastImpact = Math.max(b.lastImpact, impact);
      } else {
        b.vy = 0;
        b.grounded = true;
      }
      b.vx *= Math.exp(-P.floorFriction * P.dt);
    } else b.vy = Math.min(0, b.vy);
  }
}

/**
 * Advance by a variable frame time using a fixed-step accumulator.
 * Returns the remaining accumulator (pass it back next frame) and the largest impact.
 */
export function simulate(b, frameDt, acc, env, P = PHYSICS) {
  acc += Math.min(frameDt, P.maxFrame);
  let impact = 0;
  let steps = 0;
  while (acc >= P.dt - 1e-9 && steps < 24) {
    stepBody(b, P.dt, env, P);
    impact = Math.max(impact, b.lastImpact);
    acc -= P.dt;
    steps++;
  }
  return { acc, impact };
}

/** Axis-aligned half extents of a rotated w×h box. */
export function rotatedHalfExtents(w, h, angleRad) {
  const c = Math.abs(Math.cos(angleRad));
  const s = Math.abs(Math.sin(angleRad));
  return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
}
