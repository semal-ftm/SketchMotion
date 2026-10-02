import { useEffect, useRef, useState } from 'react';
import { Sparkles, MousePointer2, Keyboard, Pause } from 'lucide-react';
import { SceneEngine } from './SceneEngine.js';
import { loadImage } from '../capture/imageUtils.js';
import { Button, StatusPill } from '../ui/primitives.jsx';
import { HAND_STATUS } from '../controls/HandControlPanel.jsx';

const TOASTS = {
  miss: 'Pinch a little closer to the character',
  grab: 'Got it! Open your fingers to let go',
};

export function SceneCanvas({ engineRef, spriteUrl, spriteVersion, scene, mode, character, paused, onEvent, handStatus, onSample, sampleBusy, extracting }) {
  const canvasRef = useRef(null);
  const onEventRef = useRef(onEvent);
  const versionRef = useRef(spriteVersion);
  const [toast, setToast] = useState(null);
  const [hasSprite, setHasSprite] = useState(false);
  const [cursor, setCursor] = useState('default');
  onEventRef.current = onEvent;

  // Create / destroy the engine with the component (cleans up the RAF loop + observers).
  useEffect(() => {
    let toastTimer;
    const engine = new SceneEngine(canvasRef.current, {
      onEvent: (e) => {
        onEventRef.current?.(e);
        if (e.source === 'hand' && TOASTS[e.type]) {
          setToast(TOASTS[e.type]);
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => setToast(null), 1600);
        }
      },
    });
    engineRef.current = engine;
    if (import.meta.env.DEV) window.__sketchmotion = engine; // inspection hook for e2e checks
    return () => {
      clearTimeout(toastTimer);
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineRef]);

  useEffect(() => {
    engineRef.current?.setSettings({ scene, mode, paused, ...character });
  }, [engineRef, scene, mode, paused, character]);

  useEffect(() => {
    let alive = true;
    if (!spriteUrl) {
      engineRef.current?.setSprite(null);
      setHasSprite(false);
      return undefined;
    }
    loadImage(spriteUrl).then((img) => {
      if (!alive) return;
      const fresh = versionRef.current !== spriteVersion;
      versionRef.current = spriteVersion;
      engineRef.current?.setSprite(img, { fresh });
      setHasSprite(true);
    });
    return () => {
      alive = false;
    };
  }, [engineRef, spriteUrl, spriteVersion]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e) => {
    const engine = engineRef.current;
    const [x, y] = pos(e);
    if (engine?.pointerDown(e.pointerId, x, y)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setCursor('grabbing');
    }
  };
  const onPointerMove = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    const [x, y] = pos(e);
    if (engine.isPointerHolding) engine.pointerMove(e.pointerId, x, y);
    else if (e.pointerType === 'mouse') setCursor(engine.hitTest(x, y) ? 'grab' : 'default');
  };
  const onPointerUp = (e) => {
    engineRef.current?.pointerUp(e.pointerId);
    setCursor('default');
  };

  const onKeyDown = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    const k = {
      ArrowLeft: () => engine.nudge(-420, 0),
      ArrowRight: () => engine.nudge(420, 0),
      ArrowUp: () => engine.jump(),
      ' ': () => engine.jump(),
      ArrowDown: () => engine.nudge(0, 420),
      r: () => engine.recenter(),
      R: () => engine.recenter(),
    }[e.key];
    if (k) {
      e.preventDefault();
      k();
    }
  };

  const hs = HAND_STATUS[handStatus];
  return (
    <div className="scene-frame">
      <div
        className="scene-surface"
        tabIndex={0}
        role="application"
        aria-label="Scene. Drag the character with mouse or touch. Arrow keys nudge it, Space jumps, R recenters."
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
        />
      </div>

      {!hasSprite && (
        <div className="scene-empty">
          <div className="empty-card">
            <div className="empty-art" aria-hidden>
              <svg viewBox="0 0 120 90" width="120" height="90">
                <path d="M20 70 C 22 40, 45 18, 62 22 S 98 40, 96 64 S 60 82, 40 78 S 18 76, 20 70Z" fill="#fff" stroke="#2E2A3B" strokeWidth="3" strokeLinejoin="round" strokeDasharray="6 5" />
                <circle cx="50" cy="45" r="4" fill="#2E2A3B" />
                <circle cx="70" cy="45" r="4" fill="#2E2A3B" />
                <path d="M52 58 q8 7 16 0" stroke="#2E2A3B" strokeWidth="3" fill="none" strokeLinecap="round" />
              </svg>
            </div>
            <h2>{extracting ? 'Cutting out your drawing…' : 'Your drawing will appear here'}</h2>
            <p>Upload a photo of a character drawn on white paper, or start with our sample monster.</p>
            <Button variant="primary" icon={Sparkles} onClick={onSample} busy={sampleBusy || extracting}>
              Try the sample drawing
            </Button>
          </div>
        </div>
      )}

      <div className="scene-chips">
        {handStatus !== 'off' && (
          <StatusPill tone={hs.tone} pulse={hs.pulse}>
            {hs.label}
          </StatusPill>
        )}
        {paused && (
          <span className="pill pill-neutral">
            <Pause size={14} aria-hidden /> Paused
          </span>
        )}
      </div>

      {toast && (
        <div className="scene-toast" role="status">
          {toast}
        </div>
      )}

      {hasSprite && (
        <div className="scene-hints" aria-hidden>
          <span>
            <MousePointer2 size={14} /> Drag &amp; throw with mouse or touch
          </span>
          <span>
            <Keyboard size={14} /> Arrows · Space · R
          </span>
        </div>
      )}
    </div>
  );
}
