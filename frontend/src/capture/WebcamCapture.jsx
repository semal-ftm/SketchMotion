import { useEffect, useRef, useState } from 'react';
import { Camera, Timer, X, AlertTriangle } from 'lucide-react';
import { Button, IconButton, Callout } from '../ui/primitives.jsx';
import { describeCameraError } from '../tracking/handTracker.js';

/**
 * Modal that captures ONE still frame of the paper drawing.
 * The camera opens only after the user clicked "Webcam" and is released
 * as soon as the photo is taken or the dialog closes.
 */
export function WebcamCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureBtn = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [useTimer, setUseTimer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        setReady(true);
        captureBtn.current?.focus();
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err));
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function snap() {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onCapture({ url: URL.createObjectURL(blob), width: c.width, height: c.height });
      },
      'image/jpeg',
      0.95,
    );
  }

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const id = setTimeout(() => {
      if (countdown === 1) snap();
      setCountdown((n) => n - 1);
    }, 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cam-title">
        <header className="modal-head">
          <h2 id="cam-title">Capture your drawing</h2>
          <IconButton icon={X} label="Close camera" onClick={onClose} />
        </header>
        <div className="cam-stage">
          {/* Not mirrored: the drawing should look exactly like the paper. */}
          <video ref={videoRef} playsInline muted />
          {!ready && !error && <div className="cam-overlay">Starting camera…</div>}
          {ready && <div className="cam-frame" aria-hidden />}
          {countdown > 0 && (
            <div className="cam-count" aria-live="assertive">
              {countdown}
            </div>
          )}
        </div>
        {error ? (
          <Callout tone="error" icon={AlertTriangle} title="Camera unavailable">
            <p>{error}</p>
            <p>You can still upload a photo taken with your phone.</p>
          </Callout>
        ) : (
          <p className="hint">Hold the paper flat inside the frame, fill most of it, and avoid shadows from your hand.</p>
        )}
        <footer className="modal-foot">
          <Button variant="ghost" icon={Timer} aria-pressed={useTimer} className={useTimer ? 'is-on' : ''} onClick={() => setUseTimer((t) => !t)}>
            3 s timer {useTimer ? 'on' : 'off'}
          </Button>
          <Button
            ref={captureBtn}
            variant="primary"
            icon={Camera}
            disabled={!ready || countdown > 0}
            onClick={() => (useTimer ? setCountdown(3) : snap())}
          >
            Take photo
          </Button>
        </footer>
      </div>
    </div>
  );
}
