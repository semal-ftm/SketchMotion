export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_SIDE = 1600; // matches the backend working resolution

/** Returns an error message, or null if the file looks acceptable. */
export function validateFile(file) {
  if (!file) return 'No file was selected.';
  const nameOk = /\.(png|jpe?g)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !nameOk) {
    return `“${file.name}” is not a PNG or JPEG image. Please choose a .png or .jpg photo of your drawing.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB. Try a smaller photo.`;
  }
  if (file.size === 0) return 'This file is empty.';
  return null;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened. It may be damaged or in an unsupported format.'));
    img.src = url;
  });
}

/**
 * Crops (normalised rect) and downsizes the source image in the browser, then
 * encodes a PNG. Browsers apply EXIF orientation when drawing, so phone photos
 * arrive upright. Only this still image is ever sent to the server.
 */
export async function cropToBlob(url, crop, maxSide = MAX_UPLOAD_SIDE) {
  const img = await loadImage(url);
  const sx = Math.round(crop.x * img.naturalWidth);
  const sy = Math.round(crop.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the cropped image.'))), 'image/png'),
  );
  return { blob, width: canvas.width, height: canvas.height };
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
