"""SketchMotion FastAPI service.

Only still drawings are sent here; continuous webcam hand tracking stays in
the browser. Run with:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .extraction import ExtractionError, ExtractionOptions, extract_character, to_png_data_url

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg"}

app = FastAPI(title="SketchMotion API", version="1.0.0",
              description="Classical OpenCV extraction of hand-drawn characters.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:4173", "http://127.0.0.1:4173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _error(status: int, code: str, message: str, tips: list[str]) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"ok": False, "code": code, "message": message, "tips": tips})


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "opencv": cv2.__version__, "numpy": np.__version__}


@app.post("/api/extract")
def extract(
    file: UploadFile = File(..., description="PNG or JPEG photo of the drawing"),
    threshold: Optional[int] = Form(None, ge=1, le=254, description="Manual ink threshold; omit for auto"),
    gap_close: int = Form(1, ge=0, le=3),
    keep_largest_only: bool = Form(False),
    clean_colors: bool = Form(True),
    include_steps: bool = Form(True),
):
    # Plain `def` endpoint: FastAPI runs it in a worker thread, so CPU-bound
    # OpenCV work never blocks the event loop.
    if file.content_type not in ALLOWED_TYPES:
        return _error(415, "unsupported_type",
                      f"Unsupported file type “{file.content_type}”.",
                      ["Upload a PNG or JPEG image."])
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return _error(413, "file_too_large", "The image is larger than 10 MB.",
                      ["Resize the photo or take it at a lower resolution."])

    started = time.perf_counter()
    try:
        result = extract_character(data, ExtractionOptions(
            threshold=threshold, gap_close=gap_close, keep_largest_only=keep_largest_only,
            clean_colors=clean_colors, include_steps=include_steps))
    except ExtractionError as err:
        return JSONResponse(status_code=422, content=err.to_dict())

    h, w = result.mask.shape
    return {
        "ok": True,
        "sprite": to_png_data_url(result.sprite_rgba),
        "rgb": to_png_data_url(result.rgb),
        "mask": to_png_data_url(result.mask),
        "width": w,
        "height": h,
        "bbox": list(result.bbox),
        "stats": result.stats,
        "warnings": result.warnings,
        "steps": [{"id": k, "image": to_png_data_url(v)} for k, v in sorted(result.steps.items())],
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
    }


# Production convenience: serve the built frontend from the same origin.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
