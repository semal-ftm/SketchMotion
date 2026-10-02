import { Flower2, Orbit, Palette, Layers } from 'lucide-react';
import { useAppState } from '../state/AppState.jsx';
import { Card } from '../ui/primitives.jsx';

const SCENES = [
  { id: 'garden', label: 'Dream Garden', icon: Flower2, desc: 'Flowers & drifting pollen' },
  { id: 'cosmic', label: 'Cosmic Playground', icon: Orbit, desc: 'Low gravity among the stars' },
  { id: 'studio', label: 'Creative Studio', icon: Palette, desc: 'Clean pastel stage' },
];

export function ScenePicker() {
  const { state, dispatch } = useAppState();
  return (
    <Card title="Scene" icon={Layers}>
      <div className="scene-grid" role="radiogroup" aria-label="Scene">
        {SCENES.map((s) => {
          const active = state.scene === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`scene-card scene-${s.id} ${active ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'setScene', scene: s.id })}
            >
              <span className="scene-thumb" aria-hidden>
                <Icon size={18} />
              </span>
              <span className="scene-text">
                <strong>{s.label}</strong>
                <small>{s.desc}</small>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
