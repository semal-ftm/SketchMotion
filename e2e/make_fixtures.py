"""Build e2e fixtures, including a fake webcam stream with a REAL hand.

    ..\\backend\\.venv\\Scripts\\python make_fixtures.py

Downloads two public MediaPipe test photos (pointing_up.jpg, fist.jpg) and
writes fixtures/hand.mjpeg — a 9 s Motion-JPEG clip that Chrome plays as the
camera via --use-file-for-fake-video-capture:

  0-2 s   pointing hand (open, thumb far from index)  -> "Ready"
  2-3.5 s fist: thumb touches curled index            -> pinch => grab
  3.5-5 s fist moving right in the raw frame          -> drag (mirrored: left on screen)
  5-6.5 s pointing again                              -> release / throw
  6.5-7.5 s empty wall                                -> grace period, then "lost"
  7.5-9 s pointing                                    -> found again
"""

import urllib.request
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures"
FIX.mkdir(exist_ok=True)
BASE = "https://storage.googleapis.com/mediapipe-assets/"

for name in ("pointing_up.jpg", "fist.jpg"):
    if not (FIX / name).exists():
        urllib.request.urlretrieve(BASE + name, FIX / name)

rng = np.random.default_rng(0)
W, H = 640, 480


def wall():
    bg = np.full((H, W, 3), (212, 214, 216), np.float32) + rng.normal(0, 4, (H, W, 3))
    return np.clip(bg, 0, 255).astype(np.uint8)


def place(img, cx, cy, h=300):
    frame = wall()
    s = h / img.shape[0]
    im = cv2.resize(img, (int(img.shape[1] * s), h))
    x0, y0 = int(cx - im.shape[1] / 2), int(cy - h / 2)
    x1, y1 = max(0, x0), max(0, y0)
    x2, y2 = min(W, x0 + im.shape[1]), min(H, y0 + h)
    frame[y1:y2, x1:x2] = im[y1 - y0:y2 - y0, x1 - x0:x2 - x0]
    return frame


point = cv2.imread(str(FIX / "pointing_up.jpg"))
fist = cv2.imread(str(FIX / "fist.jpg"))
seq = [("p", 320, 280)] * 60
seq += [("f", 320, 280)] * 45
seq += [("f", 320 + i * 3, 280 - i * 1.5) for i in range(45)]
seq += [("p", 455, 212)] * 45
seq += [("n", 0, 0)] * 30
seq += [("p", 320, 280)] * 45

with open(FIX / "hand.mjpeg", "wb") as fh:
    for kind, x, y in seq:
        frame = wall() if kind == "n" else place(point if kind == "p" else fist, x, y)
        fh.write(cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes())

cv2.imwrite(str(FIX / "blank.png"), np.full((700, 900, 3), 248, np.uint8))
(FIX / "notes.txt").write_text("not an image")
print(f"Wrote {len(seq)} frames to {FIX / 'hand.mjpeg'} plus blank.png / notes.txt")
