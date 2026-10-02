"""SketchMotion drawing-extraction pipeline (OpenCV + NumPy).

Turns a photo/scan of a character drawn on white paper into a transparent
sprite. The pipeline is intentionally classical (no ML) so every stage is
explainable and tunable:

  1. Decode + downscale            -> bounded working resolution
  2. Paper-illumination model      -> fit a smooth quadratic "paper surface"
                                      per channel to bright, unsaturated pixels
  3. Normalisation                 -> divide by the surface: shadows/vignetting
                                      and colour casts are flattened, paper ~255
  4. Ink mask                      -> grayscale threshold (auto or manual)
                                      OR'ed with a saturation mask so light
                                      coloured strokes/fills are kept
  5. Noise filtering               -> median blur, morphological opening,
                                      small-component removal
  6. Gap bridging                  -> morphological closing (auto-escalated if
                                      the outline looks open)
  7. Border rejection              -> drop components hugging the photo edge
                                      (table, paper edge, shadows)
  8. Contour selection + filling   -> keep the main character (+ nearby parts),
                                      fill external contours so enclosed white
                                      areas (eyes, belly...) stay opaque
  9. Alpha generation              -> soft 1px anti-aliased alpha, crop, RGBA

Failures raise ExtractionError with a machine-readable code and human tips
instead of returning a misleading cut-out.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import numpy as np

MAX_SIDE = 1600          # working resolution cap (px)
PREVIEW_SIDE = 220       # pipeline-step thumbnails
GAP_LEVELS = (3, 7, 11, 17)  # closing kernel (px at 1000px short side), per level


class ExtractionError(Exception):
    """Extraction failed for a reason the user can fix."""

    def __init__(self, code: str, message: str, tips: list[str]):
        super().__init__(message)
        self.code = code
        self.message = message
        self.tips = tips

    def to_dict(self) -> dict:
        return {"ok": False, "code": self.code, "message": self.message, "tips": self.tips}


@dataclass
class ExtractionOptions:
    threshold: int | None = None  # None = automatic; else 0..255 on normalised gray
    gap_close: int = 1            # 0..3 index into GAP_LEVELS
    keep_largest_only: bool = False
    clean_colors: bool = True     # use illumination-corrected colours in the sprite
    include_steps: bool = True


@dataclass
class ExtractionResult:
    sprite_rgba: np.ndarray       # cropped BGRA
    rgb: np.ndarray               # cropped BGR (no alpha) for client-side mask edits
    mask: np.ndarray              # cropped uint8 alpha
    bbox: tuple[int, int, int, int]
    stats: dict
    warnings: list[str] = field(default_factory=list)
    steps: dict[str, np.ndarray] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 1. Decoding
# --------------------------------------------------------------------------- #
def decode_image(data: bytes) -> np.ndarray:
    """Decode PNG/JPEG bytes to BGR, compositing any alpha over white."""
    if not data:
        raise ExtractionError("empty_file", "The uploaded file is empty.",
                              ["Choose a PNG or JPEG photo of your drawing."])
    arr = np.frombuffer(data, np.uint8)
    is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
    # JPEG: IMREAD_COLOR honours EXIF orientation. PNG: keep alpha if present.
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED if is_png else cv2.IMREAD_COLOR)
    if img is None:
        raise ExtractionError("invalid_image", "This file could not be read as an image.",
                              ["Make sure the file is a real PNG or JPEG (not HEIC/WebP renamed).",
                               "Try re-exporting the photo from your phone or gallery app."])
    if img.dtype != np.uint8:  # 16-bit PNGs
        img = cv2.convertScaleAbs(img, alpha=255.0 / max(1, int(img.max())))
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1 - alpha)).astype(np.uint8)

    h, w = img.shape[:2]
    if min(h, w) < 64:
        raise ExtractionError("image_too_small", f"The image is only {w}×{h}px.",
                              ["Use a photo at least 300px on each side."])
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return img


# --------------------------------------------------------------------------- #
# 2-3. Paper illumination model + normalisation
# --------------------------------------------------------------------------- #
def _poly_design(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    return np.stack([np.ones_like(xs), xs, ys, xs * xs, xs * ys, ys * ys], axis=1)


def estimate_paper_surface(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Fit a quadratic illumination surface per channel to paper pixels.

    Returns (surface_bgr float32 HxWx3, paper_mask_small, paper_noise_sigma).
    Fitting a low-order surface (instead of a big morphological filter) means
    large coloured fills never leak into the background estimate.
    """
    h, w = bgr.shape[:2]
    sw = 160
    sh = max(8, round(h * sw / w))
    small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)[:, :, 1]

    t, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper = (gray > t) & (sat < 70)
    if paper.sum() < 0.05 * gray.size:  # very low contrast: fall back to brightest half
        paper = gray >= np.median(gray)

    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    xx /= sw - 1
    yy /= sh - 1
    gray_f = gray.astype(np.float32)
    for _ in range(3):  # robust refit: drop pixels well below the surface
        ys, xs = np.nonzero(paper)
        A = _poly_design(xx[ys, xs], yy[ys, xs])
        coef, *_ = np.linalg.lstsq(A, gray_f[ys, xs], rcond=None)
        surf = (_poly_design(xx.ravel(), yy.ravel()) @ coef).reshape(sh, sw)
        resid = gray_f - surf
        sigma = 1.4826 * np.median(np.abs(resid[paper])) + 1e-3
        new_paper = paper & (resid > -3 * sigma)
        if new_paper.sum() < 50 or new_paper.sum() == paper.sum():
            break
        paper = new_paper

    ys, xs = np.nonzero(paper)
    A = _poly_design(xx[ys, xs], yy[ys, xs])
    fy, fx = np.mgrid[0:h, 0:w].astype(np.float32)
    full = _poly_design((fx / (w - 1)).ravel(), (fy / (h - 1)).ravel())
    surface = np.empty((h, w, 3), np.float32)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, small[:, :, c][ys, xs].astype(np.float32), rcond=None)
        surface[:, :, c] = (full @ coef).reshape(h, w)
    np.clip(surface, 20, 255, out=surface)
    paper_sigma = float(1.4826 * np.median(np.abs(resid[paper])))
    return surface, paper, paper_sigma


def normalise(bgr: np.ndarray, surface: np.ndarray) -> np.ndarray:
    """Divide by the paper surface so paper becomes ~white everywhere."""
    out = bgr.astype(np.float32) / surface * 255.0
    return np.clip(out, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _ellipse(k: int) -> np.ndarray:
    k = max(1, int(k)) | 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def _remove_small(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return np.where(keep[labels], 255, 0).astype(np.uint8)


def _reject_border(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove components that look like table/paper-edge/shadow at the frame border.

    A character that was cropped tightly may touch one edge briefly, so we only
    reject components with long border contact or contact on 3+ sides.
    """
    h, w = mask.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    perimeter = 2 * (h + w)
    removed = 0
    out = mask.copy()
    edges = [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]
    for lbl in range(1, n):
        contact = sum(int(np.count_nonzero(e == lbl)) for e in edges)
        if contact == 0:
            continue
        sides = sum(1 for e in edges if np.any(e == lbl))
        if contact > 0.06 * perimeter or sides >= 3:
            out[labels == lbl] = 0
            removed += 1
    return out, removed


def _select_character(mask: np.ndarray, keep_largest: bool):
    """Pick the main character contour plus nearby detached parts."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return [], None
    areas = [cv2.contourArea(c) for c in contours]
    order = np.argsort(areas)[::-1]
    main = contours[order[0]]
    if keep_largest:
        return [main], main
    x, y, bw, bh = cv2.boundingRect(main)
    mx, my = 0.35 * bw, 0.35 * bh
    region = (x - mx, y - my, x + bw + mx, y + bh + my)
    kept = [main]
    for i in order[1:]:
        if areas[i] < 0.02 * areas[order[0]]:
            continue
        cx, cy, cw, ch = cv2.boundingRect(contours[i])
        if cx < region[2] and cx + cw > region[0] and cy < region[3] and cy + ch > region[1]:
            kept.append(contours[i])
    return kept, main


def _thumb(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    s = PREVIEW_SIDE / max(h, w)
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


# --------------------------------------------------------------------------- #
# Main pipeline
# --------------------------------------------------------------------------- #
def extract_character(data: bytes, opts: ExtractionOptions | None = None) -> ExtractionResult:
    opts = opts or ExtractionOptions()
    bgr = decode_image(data)
    h, w = bgr.shape[:2]
    total = h * w
    unit = min(h, w) / 1000.0  # scale morphology with resolution
    warnings: list[str] = []
    steps: dict[str, np.ndarray] = {}

    # --- 2-3. illumination model ------------------------------------------ #
    surface, _, paper_sigma = estimate_paper_surface(bgr)
    paper_level = float(cv2.cvtColor(surface.astype(np.uint8)[::8, ::8], cv2.COLOR_BGR2GRAY).mean())
    if paper_level < 70:
        raise ExtractionError(
            "too_dark", "The photo is too dark to tell paper from ink.",
            ["Take the photo in brighter, even light (near a window works well).",
             "Avoid using the camera at night without a lamp.",
             "Make sure the drawing is on white paper."])
    cleaned = normalise(bgr, surface)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)          # grayscale for the mask
    norm = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)
    norm = cv2.GaussianBlur(norm, (0, 0), 0.8 * max(1.0, unit))
    if opts.include_steps:
        steps["1_grayscale"] = gray
        steps["2_normalised"] = norm

    # --- 4. ink mask ------------------------------------------------------- #
    if opts.threshold is None:
        noise = max(paper_sigma * 255.0 / max(paper_level, 1.0), 1.0)
        thr = int(np.clip(255 - max(7 * noise, 32), 130, 223))
        thr_mode = "auto"
    else:
        thr = int(np.clip(opts.threshold, 1, 254))
        thr_mode = "manual"
    dark = norm < thr
    hsv = cv2.cvtColor(cleaned, cv2.COLOR_BGR2HSV)
    sat_thr = 75 if thr_mode == "auto" else int(np.interp(thr, [100, 250], [140, 45]))
    colourful = (hsv[:, :, 1] > sat_thr) & (hsv[:, :, 2] > 50)
    ink = ((dark | colourful) * 255).astype(np.uint8)
    if opts.include_steps:
        steps["3_threshold"] = ink.copy()

    # --- 5. noise filtering ------------------------------------------------ #
    ink = cv2.medianBlur(ink, 3 if unit < 1.2 else 5)
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, _ellipse(max(2, round(2 * unit))))
    ink = _remove_small(ink, max(30, int(0.00012 * total)))

    ink_ratio = np.count_nonzero(ink) / total
    if ink_ratio > 0.6:
        raise ExtractionError(
            "background_not_detected",
            f"{ink_ratio:.0%} of the image looks like ink, so the paper could not be separated.",
            ["Photograph the drawing on plain white paper.",
             "Crop away the table or background around the paper.",
             "If the result is close, lower the threshold slider."])

    # --- 7. border rejection (before closing so gaps don't merge with the border) #
    ink, border_removed = _reject_border(ink)
    if border_removed:
        warnings.append("Ignored dark areas touching the photo edge (table, paper edge or shadow).")

    if np.count_nonzero(ink) == 0:
        raise ExtractionError(
            "no_drawing_found", "No drawing lines were found on the paper.",
            ["Draw with a dark pen or marker — light pencil may be too faint.",
             "Raise the threshold slider to pick up fainter lines.",
             "Make sure the character is not touching the edge of the photo; crop with a margin."])

    # --- 6 + 8. gap bridging, contour selection, filling ------------------- #
    level = int(np.clip(opts.gap_close, 0, len(GAP_LEVELS) - 1))
    attempt = None
    # Try the requested level, escalating once if the outline still looks open.
    for lvl in range(level, min(level + 2, len(GAP_LEVELS))):
        k = max(3, round(GAP_LEVELS[lvl] * unit))
        closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, _ellipse(k))
        kept, main = _select_character(closed, opts.keep_largest_only)
        if not kept:
            continue
        filled = np.zeros_like(closed)
        cv2.drawContours(filled, kept, -1, 255, thickness=cv2.FILLED)
        stroke = np.count_nonzero(cv2.bitwise_and(closed, filled))
        fill_gain = np.count_nonzero(filled) / max(stroke, 1)
        hull_area = cv2.contourArea(cv2.convexHull(main))
        solidity = cv2.contourArea(main) / max(hull_area, 1)
        attempt = dict(level=lvl, kernel=k, closed=closed, kept=kept, main=main,
                       filled=filled, fill_gain=fill_gain, solidity=solidity)
        # A closed outline encloses interior paper: filled area >> stroke area.
        if fill_gain >= 1.6 or solidity >= 0.5:
            break
    if attempt is None:
        raise ExtractionError(
            "no_drawing_found", "No character outline could be found.",
            ["Draw one character with a clear, closed outline.",
             "Raise the threshold slider if the lines are faint."])

    if attempt["level"] > level:
        warnings.append(f"Bridged small gaps in the outline automatically (gap closing level {attempt['level']}).")
    closed_outline = attempt["fill_gain"] >= 1.6 or attempt["solidity"] >= 0.5
    if not closed_outline:
        warnings.append("The outline does not look closed, so the inside may be see-through. "
                        "Close any gaps in the drawing or raise “Gap closing”.")

    mask = attempt["filled"]
    fg_ratio = np.count_nonzero(mask) / total
    if fg_ratio < 0.003:
        raise ExtractionError(
            "drawing_too_small", "The character is tiny compared to the photo.",
            ["Move the camera closer or crop around the character.",
             "Draw the character larger on the page."])
    if fg_ratio > 0.92:
        raise ExtractionError(
            "background_not_detected", "The detected character covers almost the entire photo.",
            ["Leave some white paper around the character.",
             "Crop away the background around the paper.",
             "Lower the threshold slider."])
    if len(attempt["kept"]) > 1:
        warnings.append(f"Combined {len(attempt['kept'])} separate parts into one character.")

    if opts.include_steps:
        steps["4_cleaned_mask"] = attempt["closed"]
        steps["5_filled_mask"] = mask

    # --- 9. alpha generation ----------------------------------------------- #
    alpha = cv2.dilate(mask, _ellipse(3))  # keep the anti-aliased outline edge
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.9)
    ys, xs = np.nonzero(alpha > 8)
    pad = max(6, round(8 * unit))
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(w, int(xs.max()) + pad + 1), min(h, int(ys.max()) + pad + 1)

    colour = cleaned if opts.clean_colors else bgr
    rgb = colour[y0:y1, x0:x1].copy()
    a = alpha[y0:y1, x0:x1].copy()
    sprite = np.dstack([rgb, a])

    if opts.include_steps:
        checker = _checker(rgb.shape[:2])
        af = a[:, :, None].astype(np.float32) / 255.0
        steps["6_result"] = (rgb * af + checker * (1 - af)).astype(np.uint8)

    stats = {
        "threshold_used": thr,
        "threshold_mode": thr_mode,
        "gap_close_level": attempt["level"],
        "closing_kernel_px": attempt["kernel"],
        "foreground_ratio": round(float(fg_ratio), 4),
        "parts": len(attempt["kept"]),
        "solidity": round(float(attempt["solidity"]), 3),
        "fill_gain": round(float(attempt["fill_gain"]), 2),
        "closed_outline": bool(closed_outline),
        "paper_level": round(paper_level, 1),
        "working_size": [w, h],
    }
    return ExtractionResult(sprite_rgba=sprite, rgb=rgb, mask=a, bbox=(x0, y0, x1 - x0, y1 - y0),
                            stats=stats, warnings=warnings,
                            steps={k: _thumb(v) for k, v in steps.items()})


def _checker(shape: tuple[int, int], size: int = 12) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    tile = ((yy // size + xx // size) % 2).astype(np.uint8)
    out = np.where(tile[:, :, None] == 1, 232, 252).astype(np.uint8)
    return np.repeat(out, 3, axis=2)[:, :, :3]


def to_png_data_url(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
