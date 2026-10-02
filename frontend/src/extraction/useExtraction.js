import { useCallback, useEffect, useRef } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { cropToBlob } from '../capture/imageUtils.js';
import { ExtractError, extractDrawing } from './extractApi.js';

/**
 * Runs extraction requests. A new request aborts the previous one, and stale
 * responses are ignored, so slider changes never produce overlapping or
 * out-of-order results.
 */
export function useExtraction() {
  const { dispatch } = useAppState();
  const abortRef = useRef(null);
  const reqRef = useRef(0);
  const inputUrlRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  return useCallback(
    async ({ source, crop, options, fresh }) => {
      if (!source) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const id = ++reqRef.current;
      dispatch({ type: 'extractStart' });
      try {
        const { blob } = await cropToBlob(source.url, crop);
        const result = await extractDrawing(blob, options, ctrl.signal);
        if (id !== reqRef.current) return;
        if (inputUrlRef.current) URL.revokeObjectURL(inputUrlRef.current);
        inputUrlRef.current = URL.createObjectURL(blob);
        dispatch({ type: 'extractSuccess', result: { ...result, inputUrl: inputUrlRef.current }, fresh });
      } catch (err) {
        if (err.name === 'AbortError' || id !== reqRef.current) return;
        const e = err instanceof ExtractError ? err : new ExtractError({ code: 'client_error', message: err.message, tips: [] });
        dispatch({ type: 'extractError', error: { code: e.code, message: e.message, tips: e.tips } });
      }
    },
    [dispatch],
  );
}
