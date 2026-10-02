const API = import.meta.env.VITE_API_BASE ?? '/api';

export class ExtractError extends Error {
  constructor({ code, message, tips = [] }) {
    super(message);
    this.code = code;
    this.tips = tips;
  }
}

const OFFLINE = {
  code: 'backend_offline',
  message: 'The extraction server is not reachable.',
  tips: [
    'Start the backend in a second terminal: cd backend, activate the virtualenv, then run “uvicorn app.main:app --port 8000”.',
    'Check that nothing else is using port 8000.',
  ],
};

export async function checkHealth(signal) {
  const res = await fetch(`${API}/health`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error('unhealthy');
  return data;
}

/**
 * Sends ONE still image to FastAPI for OpenCV extraction.
 * @param {Blob} blob   cropped PNG
 * @param {object} opts { autoThreshold, threshold, gapClose, keepLargestOnly, cleanColors }
 */
export async function extractDrawing(blob, opts, signal) {
  const form = new FormData();
  form.append('file', blob, 'drawing.png');
  if (!opts.autoThreshold) form.append('threshold', String(opts.threshold));
  form.append('gap_close', String(opts.gapClose));
  form.append('keep_largest_only', String(opts.keepLargestOnly));
  form.append('clean_colors', String(opts.cleanColors));
  form.append('include_steps', 'true');

  let res;
  try {
    res = await fetch(`${API}/extract`, { method: 'POST', body: form, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ExtractError(OFFLINE);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Vite's proxy answers 502/504 with an empty or HTML body when FastAPI is down.
  }
  if (!res.ok || !data?.ok) {
    if (!data || res.status === 502 || res.status === 504) throw new ExtractError(OFFLINE);
    if (res.status === 422 && Array.isArray(data.detail)) {
      throw new ExtractError({ code: 'bad_request', message: 'The server rejected the request parameters.', tips: [] });
    }
    throw new ExtractError(data);
  }
  return data;
}
