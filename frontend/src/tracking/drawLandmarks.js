import { HandLandmarker } from '@mediapipe/tasks-vision';
import { LM } from '../gestures/gestureInterpreter.js';

const CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;

/**
 * Draws the 21-point skeleton on the preview overlay. Coordinates are in the
 * raw (unmirrored) camera frame; the overlay canvas is mirrored with CSS
 * together with the <video>, so the two always line up.
 */
export function drawLandmarks(canvas, landmarks, { pinching = false } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, w / 160);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  for (const { start, end } of CONNECTIONS) {
    ctx.moveTo(landmarks[start].x * w, landmarks[start].y * h);
    ctx.lineTo(landmarks[end].x * w, landmarks[end].y * h);
  }
  ctx.stroke();
  for (let i = 0; i < landmarks.length; i++) {
    const tipLike = i === LM.THUMB_TIP || i === LM.INDEX_TIP;
    ctx.fillStyle = tipLike ? '#FFB89A' : '#B8A9F0';
    ctx.beginPath();
    ctx.arc(landmarks[i].x * w, landmarks[i].y * h, tipLike ? w / 70 : w / 120, 0, Math.PI * 2);
    ctx.fill();
  }
  const a = landmarks[LM.THUMB_TIP];
  const b = landmarks[LM.INDEX_TIP];
  ctx.strokeStyle = pinching ? '#7C6BD6' : 'rgba(255, 184, 154, 0.9)';
  ctx.setLineDash(pinching ? [] : [6, 6]);
  ctx.lineWidth = Math.max(2, w / 120);
  ctx.beginPath();
  ctx.moveTo(a.x * w, a.y * h);
  ctx.lineTo(b.x * w, b.y * h);
  ctx.stroke();
  ctx.setLineDash([]);
}
