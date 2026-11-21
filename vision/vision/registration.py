"""Camera ↔ breadboard registration.

    A = H_mat→img   from the 4 ArUco markers of the printed mat (mm → frame px)
    B = H_grid→mat  breadboard grid units → mat mm. Nominal: × 2.54 (breadboard on its outline,
                    at table height). Refined by clicking holes a1, a30, j1, j30: the click gives
                    H_grid→img directly (the real plane of the holes, ~9 mm above the table), and
                    B = A⁻¹ · H_grid→img is stored, so camera bumps are still tracked by the markers.
    H_grid→img = A · B

Stability: A is only replaced when the markers move > `move_px` (3 px); with fewer than
`min_markers` markers visible (a hand over them) the previous A is kept.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import mat

log = logging.getLogger(__name__)

CALIB_HOLES = ("a1", "a30", "j1", "j30")
# OpenCV pixel-centre coordinates → canvas coordinates (pixel (0,0) spans [0,1)).
_CV_TO_CANVAS = np.array([[1, 0, 0.5], [0, 1, 0.5], [0, 0, 1]], dtype=np.float64)


def canvas_to_cv(x: float, y: float) -> tuple[float, float]:
    return x - 0.5, y - 0.5


_ROWS = sorted(((y, r) for r, y in mat.BB_ROW_Y.items()), key=lambda t: t[0])
_RAILS = sorted(((y, r) for r, y in mat.BB_RAILS.items()), key=lambda t: t[0])


def _nominal_B() -> np.ndarray:
    return np.diag([mat.GRID_MM, mat.GRID_MM, 1.0])


def grid_to_hole(gx: float, gy: float, tol: float = 0.5) -> str | None:
    """Nearest hole to a breadboard grid position, or None if farther than `tol` units."""
    col = round(gx - 1)
    if not 1 <= col <= mat.BB_COLS or abs(gx - (col + 1)) > tol:
        return None
    for y, row in _ROWS:
        if abs(gy - y) <= tol:
            return f"{row}{col}"
    for y, rail in _RAILS:
        if abs(gy - y) <= tol:
            return f"{rail}{col}" if col % 6 != 0 else None
    return None


@dataclass
class RegistrationUpdate:
    markers: int  # markers 0..3 seen in this frame
    ok: bool  # a homography is available
    changed: bool  # H_grid→img changed in this frame (send it to the client)


class Registration:
    def __init__(self, calib_path: Path | None = None, move_px: float = 3.0, min_markers: int = 3) -> None:
        self.dict = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, mat.ARUCO_DICT))
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self.detector = cv2.aruco.ArucoDetector(self.dict, params)
        self.move_px = move_px
        self.min_markers = min_markers
        self.calib_path = calib_path
        self.A: np.ndarray | None = None  # mat mm → img px
        self.B: np.ndarray = _nominal_B()  # grid → mat mm
        self.refined = False
        self._corners: dict[int, np.ndarray] = {}  # corners used for the current A
        self.last_seen: dict[int, np.ndarray] = {}
        self._load()

    # ---------------------------------------------------------------- persistence
    def _load(self) -> None:
        if not self.calib_path or not self.calib_path.exists():
            return
        try:
            d = json.loads(self.calib_path.read_text())
            self.B = np.array(d["B"], dtype=np.float64).reshape(3, 3)
            self.refined = True
            log.info("calibración fina cargada de %s", self.calib_path)
        except (OSError, KeyError, ValueError):
            log.warning("calibración ilegible en %s", self.calib_path)

    def _save(self) -> None:
        if not self.calib_path:
            return
        self.calib_path.parent.mkdir(parents=True, exist_ok=True)
        self.calib_path.write_text(json.dumps({"B": self.B.flatten().tolist()}))

    # ---------------------------------------------------------------- markers
    def detect(self, gray: np.ndarray) -> dict[int, np.ndarray]:
        corners, ids, _ = self.detector.detectMarkers(gray)
        found: dict[int, np.ndarray] = {}
        if ids is not None:
            for c, i in zip(corners, ids.flatten(), strict=True):
                if int(i) in mat.MARKERS:
                    found[int(i)] = c.reshape(4, 2).astype(np.float64)
        return found

    def update(self, gray: np.ndarray) -> RegistrationUpdate:
        found = self.detect(gray)
        self.last_seen = found
        changed = False
        if len(found) >= self.min_markers and self._moved(found):
            src = np.array([p for i in sorted(found) for p in mat.MARKERS[i].corners()], dtype=np.float64)
            dst = np.array([p for i in sorted(found) for p in found[i]], dtype=np.float64)
            A, _ = cv2.findHomography(src, dst, 0)
            if A is not None:
                self.A = A
                self._corners = found
                changed = True
        return RegistrationUpdate(markers=len(found), ok=self.A is not None, changed=changed)

    def _moved(self, found: dict[int, np.ndarray]) -> bool:
        if self.A is None:
            return True
        common = [i for i in found if i in self._corners]
        if len(common) < 2:
            return True
        d = max(float(np.linalg.norm(found[i] - self._corners[i], axis=1).max()) for i in common)
        return d > self.move_px

    # ---------------------------------------------------------------- mapping
    @property
    def H(self) -> np.ndarray | None:
        """Breadboard grid units → frame pixels."""
        if self.A is None:
            return None
        H = self.A @ self.B
        return H / H[2, 2]

    def H_list(self) -> list[float] | None:
        """H for the browser. OpenCV puts pixel centres at integers; canvas/CSS at +0.5 → shift."""
        H = self.H
        if H is None:
            return None
        Hc = _CV_TO_CANVAS @ H
        return [round(float(v), 6) for v in (Hc / Hc[2, 2]).flatten()]

    def hole_to_pixel(self, hole: str) -> tuple[float, float] | None:
        g = mat.hole_grid(hole)
        H = self.H
        if g is None or H is None:
            return None
        p = H @ np.array([g[0], g[1], 1.0])
        return float(p[0] / p[2]), float(p[1] / p[2])

    def pixel_to_grid(self, x: float, y: float) -> tuple[float, float] | None:
        H = self.H
        if H is None:
            return None
        p = np.linalg.inv(H) @ np.array([x, y, 1.0])
        return float(p[0] / p[2]), float(p[1] / p[2])

    def pixel_to_hole(self, x: float, y: float, tol: float = 0.5) -> str | None:
        g = self.pixel_to_grid(x, y)
        return None if g is None else grid_to_hole(*g, tol=tol)

    def pitch_px(self) -> float | None:
        """Approximate size of one grid unit in pixels around the breadboard centre."""
        a, b = self.hole_to_pixel("e15"), self.hole_to_pixel("e16")
        if not a or not b:
            return None
        return float(np.hypot(b[0] - a[0], b[1] - a[1]))

    def refine_with_clicks(self, points: dict[str, tuple[float, float]]) -> str | None:
        """4-hole click calibration. Returns an error message (Spanish) or None."""
        if self.A is None:
            return "Primero tienen que verse los marcadores del tapete."
        missing = [h for h in CALIB_HOLES if h not in points]
        if missing:
            return f"Faltan clics en: {', '.join(missing)}."
        src = np.array([mat.hole_grid(h) for h in CALIB_HOLES], dtype=np.float64)
        dst = np.array([points[h] for h in CALIB_HOLES], dtype=np.float64)
        G, _ = cv2.findHomography(src, dst, 0)
        if G is None:
            return "No pude calcular la calibración: revisa que los 4 clics estén en las esquinas."
        self.B = np.linalg.inv(self.A) @ G
        self.refined = True
        self._save()
        return None

    def reset_refinement(self) -> None:
        self.B = _nominal_B()
        self.refined = False
        if self.calib_path and self.calib_path.exists():
            self.calib_path.unlink()
