import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Undo2, RotateCcw, Check, X } from 'lucide-react';
import { Button, IconButton, Segmented, Slider } from '../ui/primitives.jsx';
import { loadImage } from '../capture/imageUtils.js';

const MAX_UNDO = 20;

/**
 * Simple mask correction: paint to restore parts of the drawing the
 * extraction missed, or erase leftovers. Works on the cropped colour image +
 * alpha returned by the backend, entirely in the browser.
 */
export function MaskEditor({ rgbUrl, maskUrl, currentSprite, onApply, onCancel }) {
  const viewRef = useRef(null);
  const rgbRef = useRef(null); // HTMLImageElement
  const maskRef = useRef(null); // canvas: white with alpha = mask
  const initialMask = useRef(null); // ImageData from the backend
  const undo = useRef([]);
  const painting = useRef(null);
  const [tool, setTool] = useState('restore');
  const [size, setSize] = useState(24);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const render = useCallback(() => {
    const view = viewRef.current;
    const rgb = rgbRef.current;
    const mask = maskRef.current;
    if (!view || !rgb || !mask) return;
    const ctx = view.getContext('2d');
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.globalAlpha = 0.22; // ghost of the full photo, to see what can be restored
    ctx.drawImage(rgb, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(composite(rgb, mask), 0, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rgb, maskImg, sprite] = await Promise.all([loadImage(rgbUrl), loadImage(maskUrl), loadImage(currentSprite)]);
      if (!alive) return;
      rgbRef.current = rgb;
      const w = rgb.naturalWidth;
      const h = rgb.naturalHeight;
      viewRef.current.width = w;
      viewRef.current.height = h;
      initialMask.current = grayToAlpha(maskImg, w, h);
      // Continue from the current sprite (keeps earlier edits).
      const m = document.createElement('canvas');
      m.width = w;
      m.height = h;
      const mctx = m.getContext('2d', { willReadFrequently: true });
      mctx.drawImage(sprite, 0, 0, w, h);
      const data = mctx.getImageData(0, 0, w, h);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = data.data[i + 1] = data.data[i + 2] = 255;
      }
      mctx.putImageData(data, 0, 0);
      maskRef.current = m;
      setReady(true);
      render();
    })();
    return () => {
      alive = false;
    };
  }, [rgbUrl, maskUrl, currentSprite, render]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function pushUndo() {
    const m = maskRef.current;
    undo.current.push(m.getContext('2d').getImageData(0, 0, m.width, m.height));
    if (undo.current.length > MAX_UNDO) undo.current.shift();
    setCanUndo(true);
  }

  function doUndo() {
    const prev = undo.current.pop();
    if (!prev) return;
    maskRef.current.getContext('2d').putImageData(prev, 0, 0);
    setCanUndo(undo.current.length > 0);
    render();
  }

  function toImage(e) {
    const rect = viewRef.current.getBoundingClientRect();
    const k = viewRef.current.width / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
  }

  function stroke(from, to) {
    const ctx = maskRef.current.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * to.k;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.restore();
    render();
  }

  const onDown = (e) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pushUndo();
    const p = toImage(e);
    painting.current = p;
    stroke(p, p);
  };
  const onMove = (e) => {
    if (!painting.current) return;
    const p = toImage(e);
    stroke(painting.current, p);
    painting.current = p;
  };
  const onUp = () => {
    painting.current = null;
  };

  function resetMask() {
    pushUndo();
    maskRef.current.getContext('2d').putImageData(initialMask.current, 0, 0);
    render();
  }

  function apply() {
    onApply(composite(rgbRef.current, maskRef.current).toDataURL('image/png'));
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="mask-title">
        <header className="modal-head">
          <h2 id="mask-title">Fix the mask</h2>
          <IconButton icon={X} label="Cancel mask editing" onClick={onCancel} />
        </header>
        <div className="mask-toolbar">
          <Segmented
            label="Brush tool"
            value={tool}
            onChange={setTool}
            options={[
              { value: 'restore', label: 'Restore', icon: Brush, title: 'Paint back missing parts' },
              { value: 'erase', label: 'Erase', icon: Eraser, title: 'Remove leftovers' },
            ]}
          />
          <div className="mask-size">
            <Slider label="Brush size" min={4} max={80} value={size} onChange={setSize} format={(v) => `${v}px`} />
          </div>
          <IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={doUndo} disabled={!canUndo} />
          <IconButton icon={RotateCcw} label="Reset to automatic mask" onClick={resetMask} disabled={!ready} />
        </div>
        <div className="mask-stage checker">
          <canvas
            ref={viewRef}
            className={`mask-canvas tool-${tool}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label="Mask editing canvas. Paint to restore or erase parts of the character."
          />
          {!ready && <div className="cam-overlay">Loading…</div>}
        </div>
        <p className="hint">The faded image shows the original photo — paint over it with Restore to bring parts back.</p>
        <footer className="modal-foot">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" icon={Check} onClick={apply} disabled={!ready}>
            Apply to character
          </Button>
        </footer>
      </div>
    </div>
  );
}

function grayToAlpha(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i + 3] = d.data[i];
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
  }
  return d;
}

function composite(rgb, mask) {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(rgb, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}
