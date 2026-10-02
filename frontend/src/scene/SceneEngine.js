import { SCENES } from './backgrounds.js';
import { PHYSICS, createBody, rotatedHalfExtents, simulate } from './physics.js';
import { ParticleSystem } from './particles.js';

const HIT_ALPHA = 24; // alpha (0-255) counted as "on the drawing"
const HAND_GRAB_PAD = 36; // px of forgiveness around the sprite for pinch-grabs

/**
 * Imperative canvas engine: owns the animation loop, high-DPI canvas,
 * physics body, particles and input arbitration (pointer vs. hand).
 * React talks to it through a small method API; nothing here re-renders React.
 */
export class SceneEngine {
  constructor(canvas, { onEvent } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onEvent = onEvent ?? (() => {});
    this.settings = { scene: 'garden', scale: 1, rotation: 0, gravity: true, trails: true, paused: false, mode: 'grab' };
    this.body = createBody(0, 0);
    this.acc = 0;
    this.sprite = null; // { img, aspect, alpha, aw, ah }
    this.draw = { w: 0, h: 0 }; // sprite draw size (css px, before squash)
    this.particles = new ParticleSystem();
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.time = 0;
    this.idleTime = 0;
    this.pointerHold = null; // { id, ox, oy }
    this.hand = null; // latest GestureInterpreter state (+ queued events)
    this.handEvents = [];
    this.handHold = null; // { ox, oy }
    this.handHover = false;
    this.lastTrail = 0;
    this.fps = 0;
    this.destroyed = false;

    this._loop = this._loop.bind(this);
    this._onResize = () => this.resize();
    this.ro = new ResizeObserver(this._onResize);
    this.ro.observe(canvas.parentElement);
    window.addEventListener('resize', this._onResize); // catches DPR changes across monitors
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------------ setup
  get scene() {
    return SCENES[this.settings.scene] ?? SCENES.garden;
  }

  get floorY() {
    return this.cssH * this.scene.floorRatio;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    const oldW = this.cssW;
    const oldH = this.cssH;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this._buildBackground();
    this._updateSpriteSize();
    if (oldW && oldH) {
      // Keep the character at the same relative spot.
      this.body.x *= w / oldW;
      this.body.y *= h / oldH;
    }
    this._clampBody();
    this._render(); // redraw immediately (no blank frame while paused)
  }

  _buildBackground() {
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const octx = off.getContext('2d');
    octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scene.paintStatic(octx, this.cssW, this.cssH);
    this.bgCache = off;
    this.ambient = this.scene.createAmbient(this.cssW, this.cssH);
  }

  setSettings(patch) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    if (patch.scene && patch.scene !== prev.scene) {
      this._buildBackground();
      this.particles.clear();
      this._clampBody();
      this.body.vy = Math.min(this.body.vy, 0);
    }
    if ('scale' in patch || 'rotation' in patch) {
      this._updateSpriteSize();
      this._clampBody();
    }
    if (patch.mode && patch.mode !== prev.mode) this._releaseHand(false);
    if (patch.paused === false && prev.paused) this.last = performance.now();
    if (this.settings.paused) this._render();
  }

  /** @param img HTMLImageElement | null   @param fresh true for a newly extracted drawing (drop it in) */
  setSprite(img, { fresh = false } = {}) {
    if (!img) {
      this.sprite = null;
      this._render();
      return;
    }
    const aw = Math.min(256, img.naturalWidth);
    const ah = Math.max(1, Math.round((aw * img.naturalHeight) / img.naturalWidth));
    const off = document.createElement('canvas');
    off.width = aw;
    off.height = ah;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(img, 0, 0, aw, ah);
    const data = octx.getImageData(0, 0, aw, ah).data;
    const alpha = new Uint8Array(aw * ah);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const hadSprite = !!this.sprite;
    this.sprite = { img, aspect: img.naturalWidth / img.naturalHeight, alpha, aw, ah };
    this._updateSpriteSize();
    if (fresh || !hadSprite) this.spawn();
    else this._clampBody();
    this._render();
  }

  _updateSpriteSize() {
    if (!this.sprite) return;
    const { aspect } = this.sprite;
    let h = Math.min(this.cssH * 0.38, this.cssW * 0.42 / Math.max(aspect, 0.4), 340);
    h *= this.settings.scale;
    let w = h * aspect;
    const maxW = this.cssW * 0.8;
    const maxH = this.floorY * 0.85;
    const k = Math.min(1, maxW / w, maxH / h);
    w *= k;
    h *= k;
    this.draw = { w, h };
    const ext = rotatedHalfExtents(w * 0.94, h * 0.96, (this.settings.rotation * Math.PI) / 180);
    this.body.hw = ext.hw;
    this.body.hh = ext.hh;
  }

  _clampBody() {
    const b = this.body;
    b.x = Math.min(Math.max(b.x, b.hw), Math.max(b.hw, this.cssW - b.hw));
    b.y = Math.min(Math.max(b.y, b.hh), Math.max(b.hh, this.floorY - b.hh));
  }

  // ---------------------------------------------------------------- actions
  spawn() {
    const b = this.body;
    b.x = this.cssW / 2;
    b.y = b.hh + 8;
    b.vx = 0;
    b.vy = 0;
    b.squash = 0;
    b.squashV = 0;
    b.target = null;
    this.pointerHold = null;
    this.handHold = null;
    this.particles.clear();
  }

  recenter() {
    const b = this.body;
    b.x = this.cssW / 2;
    b.y = this.settings.gravity ? this.floorY - b.hh : this.cssH / 2;
    b.vx = b.vy = 0;
    b.squash = b.squashV = 0;
    b.target = null;
    this.pointerHold = null;
    this.handHold = null;
    this._clampBody();
    this._render();
  }

  reset() {
    this.spawn();
    this._render();
  }

  /** Keyboard nudges: impulse in px/s. */
  nudge(dx, dy) {
    if (!this.sprite || this.settings.paused) return;
    this.body.vx += dx;
    this.body.vy += dy;
  }

  jump() {
    if (!this.sprite || this.settings.paused) return;
    const g = this.settings.gravity ? this.scene.gravityScale : 0.4;
    this.body.vy = -1100 * Math.sqrt(g);
    this.body.squashV -= 3;
  }

  // ------------------------------------------------------------ hit testing
  /** True if (x, y) in css px lies on an opaque pixel of the sprite. */
  hitTest(x, y, pad = 0) {
    if (!this.sprite) return false;
    const b = this.body;
    const a = (-this.settings.rotation * Math.PI) / 180;
    const dx = x - b.x;
    const dy = y - b.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const { w, h } = this.draw;
    if (pad > 0) {
      // Forgiving ellipse test (used for hand pinches).
      return (lx / (w / 2 + pad)) ** 2 + (ly / (h / 2 + pad)) ** 2 <= 1;
    }
    const u = lx / w + 0.5;
    const v = ly / h + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const { aw, ah, alpha } = this.sprite;
    // Sample a small neighbourhood so thin lines are still easy to grab.
    const r = 2;
    const cx = Math.floor(u * aw);
    const cy = Math.floor(v * ah);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const px = cx + i;
        const py = cy + j;
        if (px >= 0 && py >= 0 && px < aw && py < ah && alpha[py * aw + px] > HIT_ALPHA) return true;
      }
    }
    return false;
  }

  // ----------------------------------------------------- pointer (mouse/touch)
  pointerDown(id, x, y) {
    if (!this.sprite || this.settings.paused || this.pointerHold) return false;
    if (!this.hitTest(x, y)) return false;
    this._releaseHand(false);
    this.pointerHold = { id, ox: this.body.x - x, oy: this.body.y - y };
    this.body.target = { x: this.body.x, y: this.body.y, stiffness: PHYSICS.holdStiffness };
    this.onEvent({ type: 'grab', source: 'pointer' });
    return true;
  }

  pointerMove(id, x, y) {
    if (!this.pointerHold || this.pointerHold.id !== id) return;
    this.body.target.x = x + this.pointerHold.ox;
    this.body.target.y = y + this.pointerHold.oy;
  }

  pointerUp(id) {
    if (!this.pointerHold || this.pointerHold.id !== id) return;
    this.pointerHold = null;
    this.body.target = null; // keeps spring velocity => natural throw
    this.onEvent({ type: 'release', source: 'pointer' });
  }

  get isPointerHolding() {
    return !!this.pointerHold;
  }

  // ------------------------------------------------------------------ hand
  /** Receives GestureInterpreter state each tracked camera frame. */
  setHand(state) {
    this.hand = state;
    if (state?.events?.length) this.handEvents.push(...state.events);
  }

  _releaseHand(emit = true) {
    if (this.handHold || (this.body.target && !this.pointerHold)) {
      this.body.target = null;
      if (this.handHold && emit) this.onEvent({ type: 'release', source: 'hand' });
    }
    this.handHold = null;
  }

  _processHand() {
    const h = this.hand;
    const events = this.handEvents.splice(0);
    if (this.pointerHold || !this.sprite) return;
    if (!h || !h.present) {
      if (events.includes('lost') || this.handHold || this.body.target) this._releaseHand();
      this.handHover = false;
      return;
    }
    const W = this.cssW;
    const H = this.cssH;
    if (this.settings.mode === 'follow') {
      const p = h.pointer;
      if (!p) return;
      this.body.target = { x: p.x * W, y: p.y * H, stiffness: PHYSICS.followStiffness };
      this.handHover = false;
      return;
    }
    // Grab & release.
    const p = h.pinchPoint;
    if (!p) return;
    const px = p.x * W;
    const py = p.y * H;
    this.handHover = !this.handHold && this.hitTest(px, py, HAND_GRAB_PAD);
    for (const e of events) {
      if (e === 'pinchstart' && !this.handHold) {
        if (this.hitTest(px, py, HAND_GRAB_PAD)) {
          // Limit the offset so the drawing sits under the fingers, but doesn't jump.
          const ox = (this.body.x - px) * 0.5;
          const oy = (this.body.y - py) * 0.5;
          this.handHold = { ox, oy };
          this.body.target = { x: this.body.x, y: this.body.y, stiffness: PHYSICS.holdStiffness };
          this.onEvent({ type: 'grab', source: 'hand' });
        } else {
          this.onEvent({ type: 'miss', source: 'hand' });
        }
      } else if (e === 'pinchend' && this.handHold) {
        this._releaseHand();
      }
    }
    if (this.handHold && this.body.target) {
      this.body.target.x = px + this.handHold.ox;
      this.body.target.y = py + this.handHold.oy;
    }
  }

  get isHandHolding() {
    return !!this.handHold;
  }

  // ------------------------------------------------------------------ loop
  _loop(now) {
    if (this.destroyed) return;
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    if (!this.settings.paused) this._update(dt);
    else this.handEvents.length = 0;
    this._render(dt);
    this.raf = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    this.time += dt;
    this._processHand();
    if (!this.sprite) return;
    const b = this.body;
    const env = {
      width: this.cssW,
      height: this.cssH,
      floorY: this.floorY,
      gravityScale: this.settings.gravity ? this.scene.gravityScale : 0,
    };
    const { acc, impact } = simulate(b, dt, this.acc, env);
    this.acc = acc;
    if (!this.settings.gravity && !b.target) {
      // Zero-g: gentle hover so the character still feels alive.
      b.vy += Math.sin(this.time * 1.6) * 14 * dt;
    }
    const speed = Math.hypot(b.vx, b.vy);
    if (impact > 450) {
      this.particles.emit(b.x, Math.min(b.y + b.hh, this.floorY), {
        count: Math.min(14, Math.round(impact / 120)),
        colors: ['rgba(255,255,255,0.9)', this.scene.trailColors[0]],
        speed: 120,
        life: 0.5,
        size: 5,
        angle: -Math.PI / 2,
        spread: Math.PI,
        kind: 'puff',
      });
      this.onEvent({ type: 'impact', speed: impact });
    }
    if (this.settings.trails && speed > 260) {
      this.lastTrail += dt;
      while (this.lastTrail > 0.016) {
        this.lastTrail -= 0.016;
        this.particles.emit(b.x + (Math.random() - 0.5) * b.hw, b.y + (Math.random() - 0.5) * b.hh, {
          colors: this.scene.trailColors,
          speed: 30,
          life: 0.6,
          size: 3.2,
        });
      }
    }
    this.idleTime = b.grounded && speed < 5 && !b.target ? this.idleTime + dt : 0;
    this.particles.update(dt);
  }

  // ---------------------------------------------------------------- render
  _render(dt = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.bgCache) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgCache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scene.drawAmbient(ctx, this.ambient, this.cssW, this.cssH, this.time, this.settings.paused ? 0 : dt);
    if (this.sprite) {
      this._drawShadow(ctx);
      this.particles.draw(ctx);
      this._drawSprite(ctx);
    }
    this._drawHandCursor(ctx);
  }

  _drawShadow(ctx) {
    const b = this.body;
    const floor = this.floorY;
    const height = Math.max(0, floor - (b.y + b.hh));
    const k = Math.max(0.25, 1 - height / (this.cssH * 0.7));
    ctx.fillStyle = this.scene.shadow;
    ctx.globalAlpha = k;
    ctx.beginPath();
    ctx.ellipse(b.x, floor + 3, b.hw * 0.85 * k * (1 + Math.max(0, b.squash)), Math.max(3, b.hw * 0.12 * k), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  _drawSprite(ctx) {
    const b = this.body;
    const { w, h } = this.draw;
    let sx = 1 + b.squash;
    let sy = 1 - b.squash * 0.9;
    if (!b.target && !b.grounded) {
      // Stretch along vertical motion while airborne.
      const st = Math.min(Math.abs(b.vy) / 5000, 0.07);
      sy *= 1 + st;
      sx *= 1 - st * 0.5;
    }
    if (this.idleTime > 0.6 && !this.settings.paused) {
      sy *= 1 + 0.014 * Math.sin(this.time * 2.4); // idle "breathing"
    }
    const grabbed = this.pointerHold || this.handHold;
    ctx.save();
    // Squash pivots around the feet so the character lands *on* the floor.
    ctx.translate(b.x, b.y + b.hh);
    ctx.scale(sx, sy);
    ctx.translate(0, -b.hh);
    ctx.rotate((this.settings.rotation * Math.PI) / 180);
    if (grabbed || this.handHover) {
      ctx.shadowColor = grabbed ? 'rgba(124, 107, 214, 0.55)' : 'rgba(255, 184, 154, 0.8)';
      ctx.shadowBlur = 24;
    }
    ctx.drawImage(this.sprite.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  _drawHandCursor(ctx) {
    const h = this.hand;
    if (!h || !h.present) return;
    const follow = this.settings.mode === 'follow';
    const p = follow ? h.pointer : h.pinchPoint;
    if (!p) return;
    const x = p.x * this.cssW;
    const y = p.y * this.cssH;
    const holding = !!this.handHold;
    const color = holding ? '#7C6BD6' : this.handHover ? '#F2875F' : follow ? '#4FB8E8' : '#9A8BE6';
    ctx.globalAlpha = h.tracking === 'grace' ? 0.45 : 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, holding || h.pinching ? 11 : 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (h.pinching || follow) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, follow && !h.pinching ? 4 : 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
