import { useRef } from 'react';

const MIN = 0.08;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Adjustable crop rectangle over the source image (normalised coordinates).
 * Drag the box to move, drag a corner to resize. Keyboard: arrows move,
 * Shift+arrows resize from the bottom-right corner.
 */
export function CropEditor({ src, aspect, crop, onChange }) {
  const wrapRef = useRef(null);
  const drag = useRef(null);

  function begin(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: crop, pointerId: e.pointerId };
  }

  function move(e) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / rect.width;
    const dy = (e.clientY - d.startY) / rect.height;
    let { x, y, w, h } = d.start;
    if (d.handle === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (d.handle.includes('w')) {
        const nx = clamp(x + dx, 0, x + w - MIN);
        w += x - nx;
        x = nx;
      }
      if (d.handle.includes('e')) w = clamp(w + dx, MIN, 1 - x);
      if (d.handle.includes('n')) {
        const ny = clamp(y + dy, 0, y + h - MIN);
        h += y - ny;
        y = ny;
      }
      if (d.handle.includes('s')) h = clamp(h + dy, MIN, 1 - y);
    }
    onChange({ x, y, w, h });
  }

  function end(e) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  function onKey(e) {
    const step = 0.01;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    let { x, y, w, h } = crop;
    if (e.shiftKey) {
      w = clamp(w + delta[0], MIN, 1 - x);
      h = clamp(h + delta[1], MIN, 1 - y);
    } else {
      x = clamp(x + delta[0], 0, 1 - w);
      y = clamp(y + delta[1], 0, 1 - h);
    }
    onChange({ x, y, w, h });
  }

  const pct = (v) => `${v * 100}%`;
  return (
    <div className="crop-outer">
      <div
        className="crop-wrap"
        ref={wrapRef}
        style={{ aspectRatio: aspect }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img src={src} alt="Your drawing — drag the frame to crop" draggable={false} />
        <div
          className="crop-box"
          style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
          onPointerDown={(e) => begin(e, 'move')}
          tabIndex={0}
          role="group"
          aria-label="Crop area. Arrow keys move it, Shift plus arrow keys resize it."
          onKeyDown={onKey}
        >
          <span className="crop-grid" aria-hidden />
          {['nw', 'ne', 'sw', 'se'].map((h) => (
            <span key={h} className={`crop-handle h-${h}`} onPointerDown={(e) => begin(e, h)} aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}
