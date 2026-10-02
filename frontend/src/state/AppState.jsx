import { createContext, useContext, useMemo, useReducer } from 'react';

/** Central UI state. Per-frame data (hand landmarks, physics) deliberately
 *  lives outside React in the SceneEngine / HandTracker to avoid re-renders. */

export const DEFAULT_CROP = { x: 0, y: 0, w: 1, h: 1 }; // normalised to the source image

export const DEFAULT_EXTRACT_OPTIONS = {
  autoThreshold: true,
  threshold: 200,
  gapClose: 1,
  keepLargestOnly: false,
  cleanColors: true,
};

export const DEFAULT_CHARACTER = {
  scale: 1,
  rotation: 0, // degrees
  gravity: true,
  trails: true,
};

const initialState = {
  source: null, // { url, name, width, height, kind: 'upload'|'camera'|'sample' }
  crop: DEFAULT_CROP,
  extractOptions: DEFAULT_EXTRACT_OPTIONS,
  extraction: { status: 'idle', result: null, error: null }, // idle|loading|success|error
  spriteUrl: null, // final sprite (after optional mask edits) shown in the scene
  spriteVersion: 0, // bumps when a *new* drawing is extracted (triggers a fresh drop)
  scene: 'garden', // garden | cosmic | studio
  mode: 'grab', // follow | grab
  character: DEFAULT_CHARACTER,
  paused: false,
  showLandmarks: true,
};

function reducer(state, action) {
  switch (action.type) {
    case 'setSource':
      return {
        ...state,
        source: action.source,
        crop: DEFAULT_CROP,
        extraction: { status: 'idle', result: null, error: null },
      };
    case 'clearSource':
      return { ...state, source: null, crop: DEFAULT_CROP, extraction: { status: 'idle', result: null, error: null } };
    case 'setCrop':
      return { ...state, crop: action.crop };
    case 'setExtractOptions':
      return { ...state, extractOptions: { ...state.extractOptions, ...action.patch } };
    case 'extractStart':
      return { ...state, extraction: { ...state.extraction, status: 'loading', error: null } };
    case 'extractSuccess':
      return {
        ...state,
        extraction: { status: 'success', result: action.result, error: null },
        spriteUrl: action.result.sprite,
        spriteVersion: action.fresh ? state.spriteVersion + 1 : state.spriteVersion,
      };
    case 'extractError':
      return { ...state, extraction: { status: 'error', result: state.extraction.result, error: action.error } };
    case 'setSpriteUrl':
      return { ...state, spriteUrl: action.url };
    case 'setScene':
      return { ...state, scene: action.scene };
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'setCharacter':
      return { ...state, character: { ...state.character, ...action.patch } };
    case 'resetCharacter':
      return { ...state, character: DEFAULT_CHARACTER, paused: false };
    case 'setPaused':
      return { ...state, paused: action.paused };
    case 'setShowLandmarks':
      return { ...state, showLandmarks: action.value };
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}

const StateCtx = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StateCtx.Provider value={value}>{children}</StateCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(StateCtx);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
