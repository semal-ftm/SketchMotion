"""HTTP contract tests for the FastAPI service."""

import base64

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.synthetic import draw_character

client = TestClient(app)


def _png(img):
    return cv2.imencode(".png", img)[1].tobytes()


def _decode_data_url(url: str) -> np.ndarray:
    assert url.startswith("data:image/png;base64,")
    raw = base64.b64decode(url.split(",", 1)[1])
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_extract_returns_transparent_png():
    r = client.post("/api/extract", files={"file": ("d.png", _png(draw_character()), "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    sprite = _decode_data_url(body["sprite"])
    assert sprite.ndim == 3 and sprite.shape[2] == 4  # real alpha channel
    assert sprite[0, 0, 3] == 0  # transparent corner
    assert sprite.shape[0] == body["height"] and sprite.shape[1] == body["width"]
    mask = _decode_data_url(body["mask"])
    assert mask.ndim == 2
    assert {s["id"] for s in body["steps"]} >= {"1_grayscale", "3_threshold", "5_filled_mask", "6_result"}


def test_manual_threshold_param():
    r = client.post(
        "/api/extract",
        files={"file": ("d.png", _png(draw_character()), "image/png")},
        data={"threshold": "180", "gap_close": "2", "keep_largest_only": "true", "include_steps": "false"},
    )
    assert r.status_code == 200
    stats = r.json()["stats"]
    assert stats["threshold_used"] == 180 and stats["threshold_mode"] == "manual"
    assert r.json()["steps"] == []


def test_rejects_unsupported_type():
    r = client.post("/api/extract", files={"file": ("d.gif", b"GIF89a....", "image/gif")})
    assert r.status_code == 415
    assert r.json()["code"] == "unsupported_type"


def test_rejects_corrupt_image_with_tips():
    r = client.post("/api/extract", files={"file": ("d.png", b"not an image", "image/png")})
    assert r.status_code == 422
    body = r.json()
    assert body["ok"] is False and body["code"] == "invalid_image" and body["tips"]


def test_blank_page_is_a_helpful_422():
    blank = np.full((600, 800, 3), 250, np.uint8)
    r = client.post("/api/extract", files={"file": ("b.png", _png(blank), "image/png")})
    assert r.status_code == 422
    assert r.json()["code"] == "no_drawing_found"


def test_rejects_oversized_upload():
    r = client.post("/api/extract", files={"file": ("big.png", b"\x89PNG" + b"0" * (10 * 1024 * 1024 + 10), "image/png")})
    assert r.status_code == 413


def test_threshold_out_of_range_is_validation_error():
    r = client.post(
        "/api/extract",
        files={"file": ("d.png", _png(draw_character()), "image/png")},
        data={"threshold": "999"},
    )
    assert r.status_code == 422
