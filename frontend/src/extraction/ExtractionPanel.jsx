import { useEffect, useRef, useState } from 'react';
import {
  Wand2, Crop, Download, Brush, AlertTriangle, Info, CheckCircle2, Microscope, RotateCcw, Loader2,
} from 'lucide-react';
import { useAppState, DEFAULT_CROP } from '../state/AppState.jsx';
import { Button, Card, Callout, Segmented, Slider, Toggle } from '../ui/primitives.jsx';
import { CropEditor } from '../capture/CropEditor.jsx';
import { downloadDataUrl } from '../capture/imageUtils.js';
import { MaskEditor } from './MaskEditor.jsx';

const STEP_LABELS = {
  '1_grayscale': 'Grayscale',
  '2_normalised': 'Lighting corrected',
  '3_threshold': 'Threshold + colour',
  '4_cleaned_mask': 'Denoised & closed',
  '5_filled_mask': 'Filled contours',
  '6_result': 'Alpha cut-out',
};

const GAP_OPTIONS = [
  { value: 0, label: 'Off', title: 'No gap bridging' },
  { value: 1, label: 'Low', title: 'Bridge tiny gaps' },
  { value: 2, label: 'Med', title: 'Bridge small gaps' },
  { value: 3, label: 'High', title: 'Bridge larger gaps (may merge nearby lines)' },
];

export function ExtractionPanel({ runExtraction }) {
  const { state, dispatch } = useAppState();
  const { source, crop, extractOptions: opts, extraction } = state;
  const { status, result, error } = extraction;
  const [maskOpen, setMaskOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(true);
  const lastCrop = useRef(null);
  const loading = status === 'loading';

  // Re-extract (debounced) when tuning options after a first attempt.
  const optsKey = JSON.stringify(opts);
  const firstOpts = useRef(optsKey);
  useEffect(() => {
    if (optsKey === firstOpts.current || !source || (!result && !error)) return undefined;
    firstOpts.current = optsKey;
    const id = setTimeout(() => runExtraction({ source, crop: lastCrop.current ?? crop, options: opts, fresh: false }), 320);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optsKey]);

  // Collapse the crop editor once we have a result; reopen for a new source.
  useEffect(() => setCropOpen(true), [source]);
  useEffect(() => {
    if (status === 'success') setCropOpen(false);
  }, [status]);

  if (!source) {
    return (
      <Card title="Crop & extract" step={2} className="is-muted">
        <p className="muted">Add a drawing first — or try the sample — and SketchMotion will cut it out of the paper.</p>
      </Card>
    );
  }

  const extract = () => {
    lastCrop.current = crop;
    runExtraction({ source, crop, options: opts, fresh: true });
  };
  const cropChanged = lastCrop.current && JSON.stringify(lastCrop.current) !== JSON.stringify(crop);
  const stats = result?.stats;

  return (
    <>
      <Card
        title="Crop & extract"
        step={2}
        actions={
          !cropOpen && (
            <Button variant="ghost" icon={Crop} onClick={() => setCropOpen(true)}>
              Adjust crop
            </Button>
          )
        }
      >
        {cropOpen && (
          <>
            <CropEditor
              src={source.url}
              aspect={source.width / source.height}
              crop={crop}
              onChange={(c) => dispatch({ type: 'setCrop', crop: c })}
            />
            <p className="hint">Drag the frame tightly around your character, leaving a little white paper.</p>
          </>
        )}
        <div className="row gap">
          <Button variant="primary" icon={Wand2} onClick={extract} busy={loading} disabled={loading} className="grow">
            {loading ? 'Extracting…' : result && !cropChanged ? 'Extract again' : 'Extract character'}
          </Button>
          {cropOpen && (
            <Button
              variant="ghost"
              icon={RotateCcw}
              aria-label="Reset crop"
              title="Reset crop"
              onClick={() => dispatch({ type: 'setCrop', crop: DEFAULT_CROP })}
            />
          )}
        </div>
      </Card>

      {(result || error || loading) && (
        <Card title="Refine the cut-out" step={3} aria-busy={loading}>
          {error && (
            <Callout tone="error" icon={AlertTriangle} title={error.message}>
              {error.tips?.length > 0 && (
                <ul className="tips-list">
                  {error.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </Callout>
          )}

          {result && (
            <>
              <div className={`compare ${loading ? 'is-loading' : ''}`}>
                <figure>
                  <div className="compare-img paper">
                    <img src={result.inputUrl} alt="Original drawing (cropped)" />
                  </div>
                  <figcaption>Before</figcaption>
                </figure>
                <figure>
                  <div className="compare-img checker">
                    <img src={state.spriteUrl ?? result.sprite} alt="Extracted character with transparent background" />
                  </div>
                  <figcaption>After</figcaption>
                </figure>
                {loading && (
                  <div className="compare-spinner" aria-hidden>
                    <Loader2 className="spin" size={22} />
                  </div>
                )}
              </div>

              {!error && (
                <div className="result-meta">
                  <CheckCircle2 size={16} aria-hidden className="ok-icon" />
                  <span>
                    Threshold {stats.threshold_used} ({stats.threshold_mode}) · {stats.parts} part{stats.parts > 1 ? 's' : ''} ·{' '}
                    {stats.closed_outline ? 'closed outline' : 'open outline'} · {Math.round(result.elapsed_ms)} ms
                  </span>
                </div>
              )}
              {result.warnings?.map((w) => (
                <Callout key={w} tone="info" icon={Info}>
                  {w}
                </Callout>
              ))}

              <div className="controls">
                <Toggle
                  label="Automatic threshold"
                  checked={opts.autoThreshold}
                  onChange={(v) =>
                    dispatch({
                      type: 'setExtractOptions',
                      patch: v ? { autoThreshold: true } : { autoThreshold: false, threshold: stats?.threshold_used ?? opts.threshold },
                    })
                  }
                />
                <Slider
                  label="Ink threshold"
                  min={100}
                  max={250}
                  value={opts.autoThreshold ? stats?.threshold_used ?? opts.threshold : opts.threshold}
                  disabled={opts.autoThreshold}
                  onChange={(v) => dispatch({ type: 'setExtractOptions', patch: { threshold: v } })}
                  hint="Higher picks up fainter lines and colours; lower ignores smudges and shadows."
                />
                <div className="field">
                  <div className="field-row">
                    <span className="label">Gap closing</span>
                  </div>
                  <Segmented
                    label="Gap closing"
                    size="sm"
                    options={GAP_OPTIONS}
                    value={opts.gapClose}
                    onChange={(v) => dispatch({ type: 'setExtractOptions', patch: { gapClose: v } })}
                  />
                </div>
                <Toggle
                  label="Main part only"
                  checked={opts.keepLargestOnly}
                  onChange={(v) => dispatch({ type: 'setExtractOptions', patch: { keepLargestOnly: v } })}
                  hint="Drops separate doodles, text or smudges near the character."
                />
                <Toggle
                  label="Clean paper colours"
                  checked={opts.cleanColors}
                  onChange={(v) => dispatch({ type: 'setExtractOptions', patch: { cleanColors: v } })}
                  hint="Removes shadows and colour cast from the lighting."
                />
              </div>

              <div className="row gap wrap">
                <Button icon={Brush} onClick={() => setMaskOpen(true)} disabled={loading}>
                  Fix mask
                </Button>
                <Button
                  icon={Download}
                  onClick={() => downloadDataUrl(state.spriteUrl ?? result.sprite, 'sketchmotion-character.png')}
                >
                  Download PNG
                </Button>
              </div>

              <details className="cv-steps">
                <summary>
                  <Microscope size={16} aria-hidden /> See the computer-vision steps
                </summary>
                <ol>
                  {result.steps?.map((s) => (
                    <li key={s.id}>
                      <img src={s.image} alt={STEP_LABELS[s.id] ?? s.id} />
                      <span>{STEP_LABELS[s.id] ?? s.id}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </Card>
      )}

      {maskOpen && result && (
        <MaskEditor
          rgbUrl={result.rgb}
          maskUrl={result.mask}
          currentSprite={state.spriteUrl ?? result.sprite}
          onCancel={() => setMaskOpen(false)}
          onApply={(url) => {
            dispatch({ type: 'setSpriteUrl', url });
            setMaskOpen(false);
          }}
        />
      )}
    </>
  );
}
