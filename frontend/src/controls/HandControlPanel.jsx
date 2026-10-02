import { Hand, Pointer, Video, VideoOff, Eye, EyeOff, AlertTriangle, Grab } from 'lucide-react';
import { useAppState } from '../state/AppState.jsx';
import { Button, Card, Callout, IconButton, Segmented, StatusPill } from '../ui/primitives.jsx';

export const HAND_STATUS = {
  off: { tone: 'neutral', label: 'Camera off' },
  loading: { tone: 'info', label: 'Starting camera & model…', pulse: true },
  searching: { tone: 'warn', label: 'Looking for your hand', pulse: true },
  ready: { tone: 'ok', label: 'Ready' },
  grabbed: { tone: 'accent', label: 'Grabbed!' },
  lost: { tone: 'warn', label: 'Hand lost — holding…', pulse: true },
  error: { tone: 'error', label: 'Camera unavailable' },
};

const MODE_HELP = {
  follow: 'Point with your index finger — the character glides after your fingertip.',
  grab: 'Pinch thumb and index finger near the character to grab it. Open your fingers to drop or throw it.',
};

export function HandControlPanel({ hand }) {
  const { state, dispatch } = useAppState();
  const { status, error, perf, videoRef, overlayRef, start, stop } = hand;
  const on = status !== 'off' && status !== 'error';
  const s = HAND_STATUS[status];
  const readyLabel = state.mode === 'follow' ? 'Ready — point to move' : 'Ready — pinch to grab';

  return (
    <Card title="Hand control" icon={Hand}>
      <Segmented
        label="Interaction mode"
        value={state.mode}
        onChange={(mode) => dispatch({ type: 'setMode', mode })}
        options={[
          { value: 'follow', label: 'Follow finger', icon: Pointer },
          { value: 'grab', label: 'Grab & release', icon: Grab },
        ]}
      />
      <p className="hint mode-help">{MODE_HELP[state.mode]}</p>

      <div className={`cam-preview ${on ? 'is-on' : ''}`}>
        {/* Video + overlay are mirrored together (selfie view). */}
        <video ref={videoRef} playsInline muted aria-label="Webcam preview for hand tracking" />
        <canvas ref={overlayRef} aria-hidden />
        {!on && (
          <div className="cam-placeholder">
            <VideoOff size={22} aria-hidden />
            <span>Camera is off</span>
          </div>
        )}
        <div className="cam-status">
          <StatusPill tone={s.tone} pulse={s.pulse}>
            {status === 'ready' ? readyLabel : s.label}
          </StatusPill>
        </div>
        {on && (
          <IconButton
            className="cam-eye"
            icon={state.showLandmarks ? Eye : EyeOff}
            label={state.showLandmarks ? 'Hide hand landmarks' : 'Show hand landmarks'}
            onClick={() => dispatch({ type: 'setShowLandmarks', value: !state.showLandmarks })}
          />
        )}
      </div>

      {on ? (
        <Button icon={VideoOff} onClick={stop} className="full">
          Stop camera
        </Button>
      ) : (
        <Button variant="primary" icon={Video} onClick={start} className="full">
          {status === 'error' ? 'Try camera again' : 'Start hand tracking'}
        </Button>
      )}

      {perf && (
        <p className="perf" aria-live="off">
          {Math.round(perf.fps)} fps · inference {perf.inferMs.toFixed(1)} ms · {perf.delegate}
          {perf.source === 'cdn' ? ' · CDN model' : ' · local model'}
        </p>
      )}
      {error && (
        <Callout tone="error" icon={AlertTriangle}>
          {error}
        </Callout>
      )}
      <p className="hint small">Video stays on your device — hand tracking runs locally in the browser.</p>
    </Card>
  );
}
