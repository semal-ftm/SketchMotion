/** Tiny pooled particle system for sparkle trails and landing puffs. */
const MAX = 160;

export class ParticleSystem {
  constructor() {
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  emit(x, y, { count = 1, colors = ['#fff'], speed = 60, life = 0.7, size = 3, gravity = 0, spread = Math.PI * 2, angle = 0, kind = 'spark' } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX) this.items.shift();
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.items.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        age: 0,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        gravity,
        kind,
      });
    }
  }

  update(dt) {
    const drag = Math.exp(-2.5 * dt);
    let j = 0;
    for (const p of this.items) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.items[j++] = p;
    }
    this.items.length = j;
  }

  draw(ctx) {
    for (const p of this.items) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k * (p.kind === 'puff' ? 0.5 : 0.9);
      ctx.fillStyle = p.color;
      const s = p.size * (p.kind === 'puff' ? 1 + (1 - k) * 1.5 : k);
      ctx.beginPath();
      if (p.kind === 'spark') {
        // 4-point sparkle
        ctx.moveTo(p.x, p.y - s * 1.6);
        ctx.quadraticCurveTo(p.x, p.y, p.x + s * 1.6, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 1.6);
        ctx.quadraticCurveTo(p.x, p.y, p.x - s * 1.6, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 1.6);
      } else {
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
