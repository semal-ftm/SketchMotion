"""Generate the bundled sample drawings.

    python tools/make_samples.py

Writes:
  frontend/public/samples/sample-monster.png       clean "scan" of a drawing
  frontend/public/samples/sample-monster-photo.jpg phone-style photo (shadow, table, cast)
"""

import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.synthetic import draw_character, photo_effects  # noqa: E402

out_dir = ROOT.parent / "frontend" / "public" / "samples"
out_dir.mkdir(parents=True, exist_ok=True)

clean = draw_character(seed=7)
cv2.imwrite(str(out_dir / "sample-monster.png"), clean)
photo = photo_effects(draw_character(seed=11, colour=(205, 160, 120)), seed=5)
cv2.imwrite(str(out_dir / "sample-monster-photo.jpg"), photo, [cv2.IMWRITE_JPEG_QUALITY, 88])
print("Wrote samples to", out_dir)
