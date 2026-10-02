import { SlidersHorizontal, Pause, Play, Crosshair, RotateCcw } from 'lucide-react';
import { useAppState } from '../state/AppState.jsx';
import { Button, Card, Slider, Toggle } from '../ui/primitives.jsx';

export function CharacterControls({ engineRef, hasSprite }) {
  const { state, dispatch } = useAppState();
  const c = state.character;
  const set = (patch) => dispatch({ type: 'setCharacter', patch });

  return (
    <Card title="Character" icon={SlidersHorizontal} className={hasSprite ? '' : 'is-muted'}>
      <Slider label="Size" min={0.4} max={1.8} step={0.05} value={c.scale} onChange={(scale) => set({ scale })} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Rotation" min={-180} max={180} value={c.rotation} onChange={(rotation) => set({ rotation })} format={(v) => `${v}°`} />
      <Toggle label="Gravity & bounce" checked={c.gravity} onChange={(gravity) => set({ gravity })} />
      <Toggle label="Sparkle trails" checked={c.trails} onChange={(trails) => set({ trails })} />
      <div className="row gap wrap actions-row">
        <Button
          icon={state.paused ? Play : Pause}
          onClick={() => dispatch({ type: 'setPaused', paused: !state.paused })}
          aria-pressed={state.paused}
          disabled={!hasSprite}
        >
          {state.paused ? 'Resume' : 'Pause'}
        </Button>
        <Button icon={Crosshair} onClick={() => engineRef.current?.recenter()} disabled={!hasSprite}>
          Recenter
        </Button>
        <Button
          icon={RotateCcw}
          onClick={() => {
            dispatch({ type: 'resetCharacter' });
            engineRef.current?.reset();
          }}
          disabled={!hasSprite}
        >
          Reset
        </Button>
      </div>
    </Card>
  );
}
