"""Procedural "hand-drawn" characters and photo degradations.

Used to generate the bundled sample drawing and realistic test inputs
(shadows, colour casts, table borders, sensor noise, JPEG artefacts).
"""

from __future__ import annotations

import cv2
import numpy as np

INK = (35, 30, 30)


def _wobbly_ellipse(cx, cy, ax, ay, rng, wobble=0.035, n=180, start=0.0, end=2 * np.pi):
    t = np.linspace(start, end, n)
    phases = rng.uniform(0, 2 * np.pi, 3)
    r = 1 + wobble * (np.sin(3 * t + phases[0]) + 0.6 * np.sin(5 * t + phases[1])
                      + 0.3 * np.sin(9 * t + phases[2]))
    pts = np.stack([cx + ax * r * np.cos(t), cy + ay * r * np.sin(t)], axis=1)
    return pts.round().astype(np.int32)


def _crayon_fill(img, pts, colour, rng, inset=0):
    """Marker-style fill: colour with texture, not quite reaching the outline."""
    mask = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    if inset:
        mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (inset, inset)))
    tex = rng.normal(0, 9, img.shape[:2]).astype(np.float32)
    tex = cv2.GaussianBlur(tex, (0, 0), 1.5)
    fill = np.clip(np.array(colour, np.float32)[None, None, :] + tex[:, :, None], 0, 255)
    m = mask[:, :, None] > 0
    img[:] = np.where(m, fill.astype(np.uint8), img)


def draw_character(width=1200, height=900, seed=7, open_outline=False, colour=(120, 175, 250)):
    """A friendly monster: coloured body, white belly + eyes (enclosed white areas)."""
    rng = np.random.default_rng(seed)
    img = np.full((height, width, 3), 250, np.uint8)
    cx, cy = width // 2, int(height * 0.52)
    s = min(width, height) / 900.0
    lw = max(3, round(7 * s))

    body = _wobbly_ellipse(cx, cy, 230 * s, 255 * s, rng)
    ear_l = np.array([[cx - 170 * s, cy - 170 * s], [cx - 215 * s, cy - 330 * s], [cx - 70 * s, cy - 235 * s]], np.int32)
    ear_r = np.array([[cx + 170 * s, cy - 170 * s], [cx + 215 * s, cy - 330 * s], [cx + 70 * s, cy - 235 * s]], np.int32)
    arm_l = _wobbly_ellipse(cx - 245 * s, cy + 20 * s, 75 * s, 34 * s, rng)
    arm_r = _wobbly_ellipse(cx + 245 * s, cy + 20 * s, 75 * s, 34 * s, rng)
    foot_l = _wobbly_ellipse(cx - 100 * s, cy + 250 * s, 70 * s, 36 * s, rng)
    foot_r = _wobbly_ellipse(cx + 100 * s, cy + 250 * s, 70 * s, 36 * s, rng)

    for part in (ear_l, ear_r, arm_l, arm_r, foot_l, foot_r, body):
        _crayon_fill(img, part, colour, rng, inset=round(9 * s))
    # White belly: enclosed paper that must stay opaque in the sprite.
    belly = _wobbly_ellipse(cx, cy + 75 * s, 120 * s, 115 * s, rng)
    cv2.fillPoly(img, [belly], (250, 250, 250))
    for part in (ear_l, ear_r, arm_l, arm_r, foot_l, foot_r):
        cv2.polylines(img, [part], True, INK, lw, cv2.LINE_AA)
    if open_outline:
        # Leave a big gap at the top of the body outline (as kids often do).
        open_body = _wobbly_ellipse(cx, cy, 230 * s, 255 * s, rng, start=-np.pi / 2 + 0.55,
                                    end=3 * np.pi / 2 - 0.55)
        cv2.polylines(img, [open_body], False, INK, lw, cv2.LINE_AA)
    else:
        cv2.polylines(img, [body], True, INK, lw, cv2.LINE_AA)
    cv2.polylines(img, [belly], True, INK, max(2, lw - 2), cv2.LINE_AA)

    # Eyes: white with outline and pupils.
    for ex in (cx - 80 * s, cx + 80 * s):
        eye = _wobbly_ellipse(ex, cy - 95 * s, 52 * s, 58 * s, rng, wobble=0.02)
        cv2.fillPoly(img, [eye], (250, 250, 250))
        cv2.polylines(img, [eye], True, INK, lw - 1, cv2.LINE_AA)
        cv2.circle(img, (int(ex + 12 * s), int(cy - 85 * s)), int(20 * s), INK, -1, cv2.LINE_AA)
        cv2.circle(img, (int(ex + 18 * s), int(cy - 93 * s)), int(6 * s), (250, 250, 250), -1, cv2.LINE_AA)
    # Cheeks + smile.
    for chx in (cx - 150 * s, cx + 150 * s):
        cv2.ellipse(img, (int(chx), int(cy - 20 * s)), (int(26 * s), int(14 * s)), 0, 0, 360,
                    (150, 120, 245), -1, cv2.LINE_AA)
    cv2.ellipse(img, (cx, int(cy - 25 * s)), (int(40 * s), int(25 * s)), 0, 15, 165, INK, lw - 1, cv2.LINE_AA)
    return img


def photo_effects(img, seed=3, table=True, shadow=True, cast=True, noise=6.0, angle=4.0, jpeg=82):
    """Simulate a phone photo: paper on a table, uneven light, colour cast, noise."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    out = img.astype(np.float32)
    if shadow:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        field = 1.0 - 0.38 * (xx / w) ** 1.6 - 0.12 * (yy / h)  # darker to the right/bottom
        out *= field[:, :, None]
    if cast:
        out *= np.array([0.86, 0.95, 1.04], np.float32)  # warm lamp (BGR)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if table:
        H, W = int(h * 1.18), int(w * 1.18)
        canvas = np.empty((H, W, 3), np.uint8)
        canvas[:] = (60, 90, 125)  # wooden table
        canvas = np.clip(canvas.astype(np.float32) + rng.normal(0, 8, canvas.shape), 0, 255).astype(np.uint8)
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 0.97)
        M[:, 2] += [(W - w) / 2, (H - h) / 2]
        paper = cv2.warpAffine(out, M, (W, H), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        pmask = cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (W, H))
        out = np.where(pmask[:, :, None] > 127, paper, canvas)
    if noise:
        out = np.clip(out.astype(np.float32) + rng.normal(0, noise, out.shape), 0, 255).astype(np.uint8)
    out = cv2.GaussianBlur(out, (0, 0), 0.7)
    if jpeg:
        _, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, jpeg])
        out = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return out
