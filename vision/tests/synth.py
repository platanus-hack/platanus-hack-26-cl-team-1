"""Synthetic camera frames of the printed mat, with a known homography (tests only)."""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np

from vision import mat
from vision.tools import make_markers as mm

FRAME_W, FRAME_H = 640, 480
_SCALE = 1 / 3  # page rendered at 300 dpi, downsampled before warping


@lru_cache(maxsize=1)
def _page() -> np.ndarray:
    page = np.array(mm.render_mat())
    return cv2.resize(page, None, fx=_SCALE, fy=_SCALE, interpolation=cv2.INTER_AREA)


def mat_to_page() -> np.ndarray:
    s = mm.DPI / 25.4 * _SCALE  # page px per mm
    return np.array([[s, 0, s * mm.OFF_X], [0, s, s * mm.OFF_Y], [0, 0, 1]], dtype=np.float64)


def frame_of_mat(quad: list[tuple[float, float]] | None = None, *, noise: float = 0.0, seed: int = 0):
    """Warp the mat so its bounding box lands on `quad` (TL, TR, BR, BL frame px).

    Returns (bgr frame, H_mat→img).
    """
    quad = quad or [(40, 70), (610, 50), (625, 420), (20, 445)]
    T = mat_to_page()
    box = np.array(
        [
            [mat.MAT_MIN_X, mat.MAT_MIN_Y],
            [mat.MAT_MAX_X, mat.MAT_MIN_Y],
            [mat.MAT_MAX_X, mat.MAT_MAX_Y],
            [mat.MAT_MIN_X, mat.MAT_MAX_Y],
        ],
        dtype=np.float64,
    )
    A, _ = cv2.findHomography(box, np.array(quad, dtype=np.float64))  # mat mm → frame px
    P = A @ np.linalg.inv(T)  # page px → frame px
    gray = cv2.warpPerspective(_page(), P, (FRAME_W, FRAME_H), flags=cv2.INTER_LINEAR, borderValue=200)
    if noise:
        rng = np.random.default_rng(seed)
        gray = np.clip(gray.astype(np.float32) + rng.normal(0, noise, gray.shape), 0, 255).astype(np.uint8)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR), A


def project(A: np.ndarray, B: np.ndarray, hole: str) -> tuple[float, float]:
    g = mat.hole_grid(hole)
    p = A @ B @ np.array([g[0], g[1], 1.0])
    return float(p[0] / p[2]), float(p[1] / p[2])


def jpeg(img: np.ndarray, q: int = 70) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    assert ok
    return buf.tobytes()
