import { useCallback, useEffect, useRef, useState } from 'react';
import { GestureInterpreter } from '../gestures/gestureInterpreter.js';
import { HandTracker, describeCameraError } from './handTracker.js';
import { drawLandmarks } from './drawLandmarks.js';

const CAMERA_ERRORS = new Set([
  'NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError',
  'NotReadableError', 'AbortError', 'NotSupportedError',
]);

/**
 * Connects HandTracker -> GestureInterpreter -> SceneEngine.
 * Per-frame data bypasses React; only coarse status changes cause renders.
 *
 * status: off | loading | searching | ready | grabbed | lost | error
 */
export function useHandTracking({ engineRef, showLandmarks }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const trackerRef = useRef(null);
  const interpRef = useRef(new GestureInterpreter());
  const statusRef = useRef('off');
  const showRef = useRef(showLandmarks);
  const perfAt = useRef(0);
  const [status, setStatusState] = useState('off');
  const [error, setError] = useState(null);
  const [perf, setPerf] = useState(null);

  showRef.current = showLandmarks;

  const setStatus = useCallback((s) => {
    if (statusRef.current !== s) {
      statusRef.current = s;
      setStatusState(s);
    }
  }, []);

  const onFrame = useCallback(
    (landmarks, ts, aspect) => {
      const state = interpRef.current.update(landmarks, ts, aspect);
      const engine = engineRef.current;
      engine?.setHand(state);

      const overlay = overlayRef.current;
      const video = videoRef.current;
      if (overlay && video) {
        if (overlay.width !== video.videoWidth) {
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
        }
        drawLandmarks(overlay, showRef.current ? landmarks : null, { pinching: state.pinching });
      }

      if (!state.present) setStatus('searching');
      else if (state.tracking === 'grace') setStatus('lost');
      else if (engine?.isHandHolding) setStatus('grabbed');
      else setStatus('ready');
    },
    [engineRef, setStatus],
  );

  const onPerf = useCallback((p) => {
    const now = performance.now();
    if (now - perfAt.current > 500) {
      perfAt.current = now;
      setPerf({ ...p });
    }
  }, []);

  const stop = useCallback(() => {
    trackerRef.current?.stop();
    interpRef.current.reset();
    engineRef.current?.setHand(null);
    const overlay = overlayRef.current;
    overlay?.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    setPerf(null);
    setStatus('off');
  }, [engineRef, setStatus]);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    setError(null);
    setStatus('loading');
    if (!trackerRef.current) trackerRef.current = new HandTracker({ onFrame, onPerf });
    try {
      await trackerRef.current.start(videoRef.current);
      interpRef.current.reset();
      setStatus('searching');
    } catch (err) {
      console.error('[SketchMotion] hand tracking failed to start', err);
      trackerRef.current.stop();
      setError(
        CAMERA_ERRORS.has(err?.name)
          ? describeCameraError(err)
          : 'The hand-tracking model could not be loaded. Check your internet connection (or run “npm run setup:mediapipe” to store it locally) and try again.',
      );
      setStatus('error');
    }
  }, [onFrame, onPerf, setStatus]);

  // Release the camera when the component unmounts or the tab is closed.
  useEffect(() => {
    const onHide = () => trackerRef.current?.stop();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      trackerRef.current?.stop();
    };
  }, []);

  // Clear the overlay immediately when landmarks are hidden.
  useEffect(() => {
    if (!showLandmarks) {
      const o = overlayRef.current;
      o?.getContext('2d').clearRect(0, 0, o.width, o.height);
    }
  }, [showLandmarks]);

  // Engine events (grab/release) update the status without waiting for the next frame.
  const notifyEngineEvent = useCallback(
    (e) => {
      if (e.source !== 'hand' || statusRef.current === 'off') return;
      if (e.type === 'grab') setStatus('grabbed');
      if (e.type === 'release') setStatus('ready');
    },
    [setStatus],
  );

  return { videoRef, overlayRef, status, error, perf, start, stop, notifyEngineEvent };
}
