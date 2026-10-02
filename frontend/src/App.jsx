import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState, DEFAULT_CROP } from './state/AppState.jsx';
import { Header } from './ui/Header.jsx';
import { CapturePanel } from './capture/CapturePanel.jsx';
import { ExtractionPanel } from './extraction/ExtractionPanel.jsx';
import { useExtraction } from './extraction/useExtraction.js';
import { checkHealth } from './extraction/extractApi.js';
import { SceneCanvas } from './scene/SceneCanvas.jsx';
import { HandControlPanel } from './controls/HandControlPanel.jsx';
import { ScenePicker } from './controls/ScenePicker.jsx';
import { CharacterControls } from './controls/CharacterControls.jsx';
import { useHandTracking } from './tracking/useHandTracking.js';
import { loadImage } from './capture/imageUtils.js';

const SAMPLE = { url: '/samples/sample-monster.png', name: 'sample-monster.png' };

export default function App() {
  const { state, dispatch } = useAppState();
  const engineRef = useRef(null);
  const runExtraction = useExtraction();
  const hand = useHandTracking({ engineRef, showLandmarks: state.showLandmarks });
  const [api, setApi] = useState({ status: 'checking' });
  const [sampleBusy, setSampleBusy] = useState(false);
  const prevSource = useRef(null);

  // Backend health (re-checked every 10 s while offline).
  useEffect(() => {
    let timer;
    const ctrl = new AbortController();
    const check = async () => {
      try {
        const h = await checkHealth(ctrl.signal);
        setApi({ status: 'ok', opencv: h.opencv });
      } catch (e) {
        if (e.name === 'AbortError') return;
        setApi({ status: 'offline' });
        timer = setTimeout(check, 10000);
      }
    };
    check();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  // Free object URLs of replaced uploads/captures.
  useEffect(() => {
    const prev = prevSource.current;
    if (prev && prev !== state.source && prev.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
    prevSource.current = state.source;
  }, [state.source]);

  const setSource = useCallback((source) => dispatch({ type: 'setSource', source }), [dispatch]);

  const loadSample = useCallback(async () => {
    setSampleBusy(true);
    try {
      const img = await loadImage(SAMPLE.url);
      const source = { ...SAMPLE, width: img.naturalWidth, height: img.naturalHeight, kind: 'sample' };
      setSource(source);
      await runExtraction({ source, crop: DEFAULT_CROP, options: state.extractOptions, fresh: true });
    } finally {
      setSampleBusy(false);
    }
  }, [runExtraction, setSource, state.extractOptions]);

  const onEngineEvent = hand.notifyEngineEvent;

  return (
    <div className="app">
      <Header api={api} />
      <main className="layout">
        <aside className="panel panel-left" aria-label="Capture and extraction">
          <CapturePanel source={state.source} onSource={setSource} onSample={loadSample} sampleBusy={sampleBusy} />
          <ExtractionPanel runExtraction={runExtraction} />
        </aside>

        <section className="stage" aria-label="Scene">
          <SceneCanvas
            engineRef={engineRef}
            spriteUrl={state.spriteUrl}
            spriteVersion={state.spriteVersion}
            scene={state.scene}
            mode={state.mode}
            character={state.character}
            paused={state.paused}
            onEvent={onEngineEvent}
            handStatus={hand.status}
            onSample={loadSample}
            sampleBusy={sampleBusy}
            extracting={state.extraction.status === 'loading'}
          />
        </section>

        <aside className="panel panel-right" aria-label="Interaction and scene settings">
          <HandControlPanel hand={hand} />
          <ScenePicker />
          <CharacterControls engineRef={engineRef} hasSprite={!!state.spriteUrl} />
        </aside>
      </main>
      <footer className="app-footer">
        <span>SketchMotion · OpenCV extraction · MediaPipe hand tracking · Canvas physics</span>
      </footer>
    </div>
  );
}
