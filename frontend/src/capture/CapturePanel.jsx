import { useRef, useState } from 'react';
import { Camera, ImagePlus, Sparkles, Lightbulb, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Card, Callout } from '../ui/primitives.jsx';
import { loadImage, validateFile } from './imageUtils.js';
import { WebcamCapture } from './WebcamCapture.jsx';

const TIPS = ['One character per page', 'White paper, dark outline', 'Close the outline — no gaps', 'Even light, no harsh shadows'];

/** Step 1: get a drawing in — upload (button or drag & drop), webcam still, or sample. */
export function CapturePanel({ source, onSource, onSample, sampleBusy }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [camOpen, setCamOpen] = useState(false);

  async function acceptFile(file) {
    const problem = validateFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      if (Math.min(img.naturalWidth, img.naturalHeight) < 120) {
        URL.revokeObjectURL(url);
        setError(`This image is only ${img.naturalWidth}×${img.naturalHeight}px. Please use a photo at least 300px on each side.`);
        return;
      }
      setError(null);
      onSource({ url, name: file.name, width: img.naturalWidth, height: img.naturalHeight, kind: 'upload' });
    } catch (e) {
      URL.revokeObjectURL(url);
      setError(e.message);
    }
  }

  return (
    <Card title="Add your drawing" step={1} className="capture-card">
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''} ${source ? 'has-source' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) acceptFile(file);
        }}
      >
        {source ? (
          <div className="source-chip">
            <img src={source.url} alt="" />
            <div>
              <strong title={source.name}>{source.name}</strong>
              <span>
                {source.width}×{source.height}px · {source.kind === 'camera' ? 'webcam' : source.kind}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="dz-illustration" aria-hidden>
              <ImagePlus size={30} />
            </div>
            <p className="dz-title">Drop a photo of your drawing</p>
            <p className="dz-sub">PNG or JPEG, up to 10 MB</p>
          </>
        )}
        <div className="dz-actions">
          <Button variant="primary" icon={source ? RefreshCw : ImagePlus} onClick={() => inputRef.current?.click()}>
            {source ? 'Replace' : 'Upload'}
          </Button>
          <Button icon={Camera} onClick={() => setCamOpen(true)}>
            Webcam
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) acceptFile(file);
          }}
        />
      </div>

      {error && (
        <Callout tone="error" icon={AlertTriangle}>
          {error}
        </Callout>
      )}

      <Button variant="ghost" icon={Sparkles} className="sample-btn" onClick={onSample} busy={sampleBusy}>
        Try the sample drawing
      </Button>

      <details className="tips" open={!source}>
        <summary>
          <Lightbulb size={16} aria-hidden /> Tips for a clean cut-out
        </summary>
        <ul>
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>

      {camOpen && (
        <WebcamCapture
          onClose={() => setCamOpen(false)}
          onCapture={(shot) => {
            setCamOpen(false);
            setError(null);
            onSource({ ...shot, name: 'Webcam capture', kind: 'camera' });
          }}
        />
      )}
    </Card>
  );
}
