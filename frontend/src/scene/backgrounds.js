/**
 * Procedural scenes. Each scene paints a static layer once per resize (cached
 * on an offscreen canvas) plus a light ambient layer every frame, so the
 * background costs ~one drawImage + a few dozen small shapes per frame.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glow(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function hill(ctx, w, baseY, amp, color, rng, bumps = 3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  const step = w / bumps;
  for (let i = 0; i < bumps; i++) {
    const x0 = i * step;
    ctx.quadraticCurveTo(x0 + step / 2, baseY - amp * (0.6 + rng() * 0.6), x0 + step, baseY - rng() * amp * 0.2);
  }
  ctx.lineTo(w, baseY + 400);
  ctx.lineTo(0, baseY + 400);
  ctx.closePath();
  ctx.fill();
}

function flower(ctx, x, y, size, petal, rng) {
  ctx.strokeStyle = '#5DA978';
  ctx.lineWidth = Math.max(1.2, size * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + size * 3);
  ctx.quadraticCurveTo(x + (rng() - 0.5) * size * 2, y + size * 1.5, x, y);
  ctx.stroke();
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * size * 0.75, y + Math.sin(a) * size * 0.75, size * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#FFD66B';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

// --------------------------------------------------------------------------- //
const garden = {
  id: 'garden',
  label: 'Dream Garden',
  floorRatio: 0.86,
  gravityScale: 1,
  trailColors: ['#FFB89A', '#B8A9F0', '#FFE38A', '#FFFFFF'],
  shadow: 'rgba(40, 90, 60, 0.22)',
  paintStatic(ctx, w, h) {
    const rng = mulberry32(11);
    const floorY = h * this.floorRatio;
    const sky = ctx.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, '#D9F2EC');
    sky.addColorStop(0.55, '#F3F8EC');
    sky.addColorStop(1, '#FFF4E4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.82, h * 0.16, Math.min(w, h) * 0.32, 'rgba(255, 214, 170, 0.9)', 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) {
      const cx = w * (0.1 + 0.25 * i + rng() * 0.08);
      const cy = h * (0.1 + rng() * 0.14);
      const s = Math.min(w, h) * (0.035 + rng() * 0.02);
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(cx + (k - 1.5) * s * 1.1, cy + (k % 2) * s * 0.3, s * 1.2, s * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    hill(ctx, w, floorY - h * 0.05, h * 0.2, '#D4EEDA', rng, 3);
    hill(ctx, w, floorY - h * 0.01, h * 0.12, '#B6E2C2', rng, 4);
    const petals = ['#FFB89A', '#C9BCF6', '#9CD3F5', '#FFC2D6', '#FFFFFF'];
    for (let i = 0; i < 26; i++) {
      const x = rng() * w;
      const y = floorY - h * 0.02 - rng() * h * 0.07;
      flower(ctx, x, y, Math.min(w, h) * (0.006 + rng() * 0.005), petals[i % petals.length], rng);
    }
    const ground = ctx.createLinearGradient(0, floorY, 0, h);
    ground.addColorStop(0, '#93D3A6');
    ground.addColorStop(1, '#78BF8F');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    for (let x = 0; x <= w; x += w / 16) ctx.lineTo(x, floorY + Math.sin(x * 0.02) * 2);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 150, 95, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < w / 9; i++) {
      const x = rng() * w;
      const y = floorY + 4 + rng() * (h - floorY - 6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 4, y - 4 - rng() * 6);
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      flower(ctx, rng() * w, floorY + 8 + rng() * (h - floorY - 16), Math.min(w, h) * 0.008, petals[i % petals.length], rng);
    }
  },
  createAmbient(w, h) {
    const rng = mulberry32(5);
    return Array.from({ length: 18 }, () => ({
      x: rng() * w,
      y: rng() * h,
      r: 1.5 + rng() * 2.5,
      speed: 6 + rng() * 10,
      phase: rng() * Math.PI * 2,
      hue: rng() > 0.5 ? 'rgba(255, 236, 170,' : 'rgba(255, 255, 255,',
    }));
  },
  drawAmbient(ctx, items, w, h, t, dt) {
    for (const p of items) {
      p.y -= p.speed * dt;
      if (p.y < -10) {
        p.y = h * this.floorRatio;
        p.x = Math.random() * w;
      }
      const x = p.x + Math.sin(t * 0.7 + p.phase) * 12;
      const a = 0.35 + 0.35 * Math.sin(t * 1.3 + p.phase);
      ctx.fillStyle = `${p.hue}${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// --------------------------------------------------------------------------- //
const cosmic = {
  id: 'cosmic',
  label: 'Cosmic Playground',
  floorRatio: 0.88,
  gravityScale: 0.45, // floaty low gravity
  trailColors: ['#B8A9F0', '#9CD3F5', '#FFFFFF', '#FFC2D6'],
  shadow: 'rgba(10, 5, 30, 0.35)',
  paintStatic(ctx, w, h) {
    const rng = mulberry32(42);
    const floorY = h * this.floorRatio;
    const bg = ctx.createRadialGradient(w * 0.35, h * 0.25, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
    bg.addColorStop(0, '#3D2C70');
    bg.addColorStop(0.5, '#22174A');
    bg.addColorStop(1, '#120C2B');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.2, h * 0.35, Math.max(w, h) * 0.35, 'rgba(184, 169, 240, 0.35)', 0.6);
    glow(ctx, w * 0.75, h * 0.6, Math.max(w, h) * 0.3, 'rgba(255, 150, 200, 0.25)', 0.6);
    glow(ctx, w * 0.55, h * 0.15, Math.max(w, h) * 0.25, 'rgba(120, 200, 255, 0.22)', 0.6);
    for (let i = 0; i < (w * h) / 2500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.5})`;
      ctx.fillRect(rng() * w, rng() * floorY, rng() > 0.9 ? 2 : 1, rng() > 0.9 ? 2 : 1);
    }
    // Ringed planet.
    const pr = Math.min(w, h) * 0.11;
    const px = w * 0.8;
    const py = h * 0.24;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.35);
    ctx.strokeStyle = 'rgba(255, 220, 190, 0.55)';
    ctx.lineWidth = pr * 0.12;
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.75, pr * 0.42, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    const pg = ctx.createLinearGradient(-pr, -pr, pr, pr);
    pg.addColorStop(0, '#FFD0B5');
    pg.addColorStop(1, '#E58E9C');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, -pr * 0.3, pr * 0.9, pr * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, pr * 0.2, pr * 0.95, pr * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.75, pr * 0.42, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    // Small mint planet + moon.
    const mg = ctx.createRadialGradient(w * 0.12 - 8, h * 0.2 - 8, 2, w * 0.12, h * 0.2, Math.min(w, h) * 0.05);
    mg.addColorStop(0, '#C9F5E3');
    mg.addColorStop(1, '#5FBF9C');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(w * 0.12, h * 0.2, Math.min(w, h) * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E9E4FF';
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.1, Math.min(w, h) * 0.018, 0, Math.PI * 2);
    ctx.fill();
    // Moon-surface floor.
    const gg = ctx.createLinearGradient(0, floorY, 0, h);
    gg.addColorStop(0, '#5A4A9C');
    gg.addColorStop(1, '#2F255F');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, floorY + 6);
    ctx.quadraticCurveTo(w / 2, floorY - 10, w, floorY + 6);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 12, 50, 0.35)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(rng() * w, floorY + 12 + rng() * (h - floorY - 16), 10 + rng() * 22, 3 + rng() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  createAmbient(w, h) {
    const rng = mulberry32(9);
    return {
      stars: Array.from({ length: 40 }, () => ({
        x: rng() * w,
        y: rng() * h * 0.8,
        r: 1.5 + rng() * 2.5,
        phase: rng() * Math.PI * 2,
        speed: 1 + rng() * 2,
      })),
      shooting: null,
      nextShot: 3,
    };
  },
  drawAmbient(ctx, amb, w, h, t, dt) {
    for (const s of amb.stars) {
      const a = 0.3 + 0.7 * Math.abs(Math.sin(t * s.speed + s.phase));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      star(ctx, s.x, s.y, s.r * (0.7 + a * 0.5));
    }
    amb.nextShot -= dt;
    if (!amb.shooting && amb.nextShot <= 0) {
      amb.shooting = { x: Math.random() * w * 0.6, y: Math.random() * h * 0.3, life: 0 };
      amb.nextShot = 5 + Math.random() * 6;
    }
    if (amb.shooting) {
      const s = amb.shooting;
      s.life += dt;
      const len = 80;
      const x = s.x + s.life * 520;
      const y = s.y + s.life * 200;
      const g = ctx.createLinearGradient(x - len, y - len * 0.38, x, y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255,255,255,${Math.max(0, 0.9 - s.life)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - len, y - len * 0.38);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (s.life > 0.9) amb.shooting = null;
    }
  },
};

// --------------------------------------------------------------------------- //
const studio = {
  id: 'studio',
  label: 'Creative Studio',
  floorRatio: 0.84,
  gravityScale: 1,
  trailColors: ['#B8A9F0', '#FFB89A', '#9EE6C8', '#9CD3F5'],
  shadow: 'rgba(90, 70, 60, 0.2)',
  paintStatic(ctx, w, h) {
    const floorY = h * this.floorRatio;
    const wall = ctx.createLinearGradient(0, 0, w, floorY);
    wall.addColorStop(0, '#FFF3EA');
    wall.addColorStop(1, '#F1EDFF');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, 0, 0, Math.min(w, h) * 0.6, 'rgba(158, 230, 200, 0.45)', 0.7);
    glow(ctx, w, floorY * 0.4, Math.min(w, h) * 0.55, 'rgba(156, 211, 245, 0.4)', 0.7);
    glow(ctx, w / 2, floorY * 0.62, Math.min(w, h) * 0.45, 'rgba(255, 255, 255, 0.9)', 0.8);
    ctx.fillStyle = 'rgba(124, 107, 214, 0.13)';
    const gap = 26;
    for (let y = gap; y < floorY - 6; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const fl = ctx.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, '#F4E7DA');
    fl.addColorStop(1, '#EAD9C8');
    ctx.fillStyle = fl;
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, floorY, w, 2);
    ctx.fillStyle = 'rgba(120, 90, 70, 0.08)';
    ctx.fillRect(0, floorY + 2, w, 6);
  },
  createAmbient(w, h) {
    const rng = mulberry32(3);
    const colors = ['#B8A9F0', '#FFB89A', '#9EE6C8', '#9CD3F5'];
    return Array.from({ length: 8 }, (_, i) => ({
      x: rng() * w,
      y: rng() * h * 0.7,
      s: 4 + rng() * 4,
      rot: rng() * Math.PI,
      spin: (rng() - 0.5) * 0.8,
      drift: 4 + rng() * 6,
      color: colors[i % colors.length],
      phase: rng() * 6,
    }));
  },
  drawAmbient(ctx, items, w, h, t, dt) {
    ctx.globalAlpha = 0.55;
    for (const c of items) {
      c.rot += c.spin * dt;
      c.y += c.drift * dt;
      if (c.y > h * this.floorRatio - 10) {
        c.y = -10;
        c.x = Math.random() * w;
      }
      ctx.save();
      ctx.translate(c.x + Math.sin(t * 0.5 + c.phase) * 10, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.s, -c.s / 2.5, c.s * 2, c.s / 1.25);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },
};

export const SCENES = { garden, cosmic, studio };
export const SCENE_LIST = [garden, cosmic, studio];
