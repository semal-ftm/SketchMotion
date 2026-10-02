import { describe, expect, it } from 'vitest';
import { PHYSICS, createBody, rotatedHalfExtents, simulate } from './physics.js';

const env = { width: 800, height: 600, floorY: 560, gravityScale: 1 };

function run(body, seconds, fps) {
  let acc = 0;
  const frame = 1 / fps;
  let maxImpact = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const r = simulate(body, frame, acc, env);
    acc = r.acc;
    maxImpact = Math.max(maxImpact, r.impact);
  }
  return maxImpact;
}

describe('physics', () => {
  it('is frame-rate independent (30 vs 144 fps give the same trajectory)', () => {
    const a = createBody(400, 100);
    const b = createBody(400, 100);
    a.vx = b.vx = 300;
    run(a, 0.5, 30);
    run(b, 0.5, 144);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
  });

  it('falls, bounces with decreasing height, and comes to rest on the floor', () => {
    const body = createBody(400, 100);
    let acc = 0;
    let bounces = 0;
    let lastVy = 0;
    for (let i = 0; i < 60 * 6; i++) {
      acc = simulate(body, 1 / 60, acc, env).acc;
      if (lastVy > 0 && body.vy < 0) bounces++;
      lastVy = body.vy;
    }
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(env.floorY - body.hh, 3);
  });

  it('squashes on impact and springs back', () => {
    const body = createBody(400, 100);
    let acc = 0;
    let maxSquash = 0;
    for (let i = 0; i < 60 * 3; i++) {
      acc = simulate(body, 1 / 60, acc, env).acc;
      maxSquash = Math.max(maxSquash, body.squash);
    }
    expect(maxSquash).toBeGreaterThan(0.05);
    expect(Math.abs(body.squash)).toBeLessThan(0.01);
  });

  it('stays inside the canvas walls even when thrown hard', () => {
    const body = createBody(400, 300);
    body.vx = 3000;
    body.vy = -3000;
    let acc = 0;
    for (let i = 0; i < 300; i++) {
      acc = simulate(body, 1 / 60, acc, env).acc;
      expect(body.x).toBeGreaterThanOrEqual(body.hw - 1e-6);
      expect(body.x).toBeLessThanOrEqual(env.width - body.hw + 1e-6);
      expect(body.y).toBeGreaterThanOrEqual(body.hh - 1e-6);
      expect(body.y).toBeLessThanOrEqual(env.floorY - body.hh + 1e-6);
    }
  });

  it('follows a target smoothly without overshoot and keeps velocity for throws', () => {
    const body = createBody(100, 300);
    body.target = { x: 600, y: 300, stiffness: PHYSICS.followStiffness };
    let acc = 0;
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      acc = simulate(body, 1 / 60, acc, env).acc;
      maxX = Math.max(maxX, body.x);
    }
    expect(body.x).toBeGreaterThan(595);
    expect(maxX).toBeLessThanOrEqual(600.5); // critically damped
    body.target = { x: 100, y: 300, stiffness: PHYSICS.holdStiffness };
    for (let i = 0; i < 4; i++) acc = simulate(body, 1 / 60, acc, env).acc;
    expect(body.vx).toBeLessThan(-200); // moving fast when "released"
  });

  it('clamps huge frame gaps (tab switch) instead of exploding', () => {
    const body = createBody(400, 100);
    simulate(body, 5, 0, env);
    expect(Number.isFinite(body.y)).toBe(true);
    expect(body.y).toBeLessThanOrEqual(env.floorY - body.hh);
  });

  it('computes rotated half extents', () => {
    const r = rotatedHalfExtents(100, 50, Math.PI / 2);
    expect(r.hw).toBeCloseTo(25);
    expect(r.hh).toBeCloseTo(50);
  });
});
