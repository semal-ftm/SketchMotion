"""Behavioural tests for the OpenCV extraction pipeline on synthetic drawings."""

import cv2
import numpy as np
import pytest

from app.extraction import ExtractionError, ExtractionOptions, extract_character
from app.synthetic import draw_character, photo_effects


def png(img: np.ndarray) -> bytes:
    return cv2.imencode(".png", img)[1].tobytes()


def jpg(img: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()


@pytest.fixture(scope="module")
def clean():
    return draw_character(seed=7)  # 1200x900, character centred at (600, 468)


def test_clean_scan_extracts_one_closed_character(clean):
    r = extract_character(png(clean))
    assert r.stats["closed_outline"]
    assert r.stats["parts"] == 1
    assert r.sprite_rgba.shape[2] == 4
    # Cropped tightly to the character, not the page.
    x, y, w, h = r.bbox
    assert w < 0.7 * clean.shape[1] and h < 0.95 * clean.shape[0]
    # Corners of the sprite are transparent paper.
    a = r.mask
    assert a[0, 0] == 0 and a[-1, -1] == 0 and a[0, -1] == 0


def test_enclosed_white_areas_stay_opaque(clean):
    """White belly and eye whites are paper-coloured but inside the outline."""
    r = extract_character(png(clean))
    x0, y0 = r.bbox[:2]
    s = 1.0  # 900px short side -> scale 1
    for px, py, name in [(600, 468 + 75, "belly"), (520 - 8, 373 - 20, "left eye white")]:
        alpha = r.mask[int(py * s) - y0, int(px * s) - x0]
        colour = r.rgb[int(py * s) - y0, int(px * s) - x0]
        assert alpha == 255, f"{name} became transparent"
        assert colour.min() > 225, f"{name} is no longer white: {colour}"


def test_original_colours_preserved(clean):
    r = extract_character(png(clean), ExtractionOptions(clean_colors=False))
    x0, y0 = r.bbox[:2]
    # A point on the orange body between belly and arm.
    body = r.rgb[468 - y0, 600 - 175 - x0].astype(int)
    expected = np.array((120, 175, 250))
    assert np.abs(body - expected).max() < 30


def test_phone_photo_with_shadow_table_and_colour_cast():
    raw = draw_character(seed=11, colour=(205, 160, 120))
    photo = photo_effects(raw, seed=5)
    r = extract_character(jpg(photo))
    W, H = r.stats["working_size"]
    x, y, w, h = r.bbox
    # The table around the paper and the shadowed paper must not be included.
    assert w < 0.6 * W and h < 0.85 * H
    assert r.stats["foreground_ratio"] < 0.35
    assert r.stats["closed_outline"]
    # Sprite is mostly opaque in its centre (body + belly filled, not just lines).
    ch, cw = r.mask.shape
    centre = r.mask[ch // 3: 2 * ch // 3, cw // 3: 2 * cw // 3]
    assert (centre > 200).mean() > 0.9
    assert any("edge" in w_ for w_ in r.warnings)  # table rejection is reported


def test_open_outline_is_bridged_or_flagged():
    img = draw_character(seed=3, open_outline=True)
    r = extract_character(png(img))
    bridged = any("Bridged" in w for w in r.warnings)
    flagged = any("not look closed" in w for w in r.warnings)
    assert bridged or flagged or r.stats["closed_outline"]


def test_blank_paper_fails_with_tips():
    blank = np.full((800, 1000, 3), 248, np.uint8)
    blank = np.clip(blank + np.random.default_rng(0).normal(0, 3, blank.shape), 0, 255).astype(np.uint8)
    with pytest.raises(ExtractionError) as e:
        extract_character(png(blank))
    assert e.value.code == "no_drawing_found"
    assert e.value.tips


def test_dark_photo_fails():
    dark = (draw_character(seed=1).astype(np.float32) * 0.18).astype(np.uint8)
    with pytest.raises(ExtractionError) as e:
        extract_character(png(dark))
    assert e.value.code == "too_dark"


def test_non_paper_image_fails():
    rng = np.random.default_rng(1)
    busy = rng.integers(0, 255, (600, 800, 3), dtype=np.uint8)
    busy = cv2.GaussianBlur(busy, (0, 0), 3)
    with pytest.raises(ExtractionError) as e:
        extract_character(png(busy))
    assert e.value.code in {"background_not_detected", "no_drawing_found", "too_dark"}


def test_invalid_bytes_fail():
    with pytest.raises(ExtractionError) as e:
        extract_character(b"definitely not an image")
    assert e.value.code == "invalid_image"


def test_manual_threshold_changes_result(clean):
    low = extract_character(png(clean), ExtractionOptions(threshold=110))
    high = extract_character(png(clean), ExtractionOptions(threshold=240))
    assert low.stats["threshold_mode"] == "manual"
    assert low.stats["threshold_used"] == 110 and high.stats["threshold_used"] == 240


def test_keep_largest_only_drops_detached_doodle(clean):
    img = clean.copy()
    cv2.circle(img, (1080, 120), 40, (30, 30, 30), 6)  # far-away doodle
    cv2.circle(img, (870, 420), 22, (30, 30, 30), 5)  # nearby detached part
    both = extract_character(png(img))
    only = extract_character(png(img), ExtractionOptions(keep_largest_only=True))
    assert both.stats["parts"] >= 2
    assert only.stats["parts"] == 1
    assert only.bbox[2] <= both.bbox[2]


def test_large_images_are_downscaled():
    big = cv2.resize(draw_character(seed=2), (3200, 2400), interpolation=cv2.INTER_LINEAR)
    r = extract_character(png(big))
    assert max(r.stats["working_size"]) == 1600


def test_rgba_input_is_composited_on_white(clean):
    rgba = cv2.cvtColor(clean, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = 255
    rgba[:40, :, 3] = 0  # transparent strip must become paper, not ink
    r = extract_character(png(rgba))
    assert r.stats["parts"] == 1
