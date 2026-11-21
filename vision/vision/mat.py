"""Calibration mat: where the 4 ArUco markers sit relative to the breadboard.

Everything is in millimetres in the *mat frame*, whose origin is the top-left
corner of the breadboard outline printed on the mat. The breadboard's own grid
(frontend/src/catalog/breadboard.ts: 1 unit = 2.54 mm, origin = top-left of the
body) therefore maps to the mat frame as mm = grid * 2.54 when the breadboard
sits exactly on its outline. Real breadboards differ by a millimetre or two and
their surface is ~9 mm above the table, so registration refines this nominal
mapping with a 4-hole click calibration (see registration.py).

Layout (top view, not to scale):

    [0]                                              [1]
         +-- Arduino Uno --+   +------ protoboard ------+
         |                 |   |                        |
         +-----------------+   +------------------------+
    [3]                                              [2]
"""

from __future__ import annotations

from dataclasses import dataclass

GRID_MM = 2.54

# Breadboard (half size, 400 points) — must match catalog/breadboard.ts
BB_COLS = 30
BB_W_UNITS = 33
BB_H_UNITS = 21
BB_ROW_Y = {"a": 5, "b": 6, "c": 7, "d": 8, "e": 9, "f": 12, "g": 13, "h": 14, "i": 15, "j": 16}
BB_RAILS = {"T+": 1, "T-": 2, "B+": 19, "B-": 20}
BB_W_MM = BB_W_UNITS * GRID_MM  # 83.82
BB_H_MM = BB_H_UNITS * GRID_MM  # 53.34

# Arduino Uno footprint placed to the left of the breadboard (guide only).
UNO_W_MM = 68.6
UNO_H_MM = 53.3
UNO_GAP_MM = 12.0
UNO_X_MM = -(UNO_GAP_MM + UNO_W_MM)
UNO_Y_MM = 0.0

# Markers: DICT_4X4_50, ids 0..3 clockwise from top-left, 20 mm side.
ARUCO_DICT = "DICT_4X4_50"
MARKER_MM = 20.0
MARKER_GAP_MM = 6.0  # gap between the work area and the marker edge

_LEFT = UNO_X_MM - MARKER_GAP_MM - MARKER_MM / 2
_RIGHT = BB_W_MM + MARKER_GAP_MM + MARKER_MM / 2
_TOP = -MARKER_GAP_MM - MARKER_MM / 2
_BOTTOM = BB_H_MM + MARKER_GAP_MM + MARKER_MM / 2


@dataclass(frozen=True)
class Marker:
    id: int
    cx: float  # centre, mat mm
    cy: float

    def corners(self) -> list[tuple[float, float]]:
        """Corners in OpenCV ArUco order: TL, TR, BR, BL (marker upright on the mat)."""
        h = MARKER_MM / 2
        return [
            (self.cx - h, self.cy - h),
            (self.cx + h, self.cy - h),
            (self.cx + h, self.cy + h),
            (self.cx - h, self.cy + h),
        ]


MARKERS: dict[int, Marker] = {
    0: Marker(0, _LEFT, _TOP),
    1: Marker(1, _RIGHT, _TOP),
    2: Marker(2, _RIGHT, _BOTTOM),
    3: Marker(3, _LEFT, _BOTTOM),
}

# Bounding box of everything printed (mm, mat frame)
MAT_MIN_X = _LEFT - MARKER_MM / 2
MAT_MAX_X = _RIGHT + MARKER_MM / 2
MAT_MIN_Y = _TOP - MARKER_MM / 2
MAT_MAX_Y = _BOTTOM + MARKER_MM / 2


def hole_grid(hole: str) -> tuple[float, float] | None:
    """Breadboard-local grid position of a hole id ('e10', 'T+3'). None if invalid."""
    if len(hole) >= 2 and hole[0] in BB_ROW_Y and hole[1:].isdigit():
        col = int(hole[1:])
        if 1 <= col <= BB_COLS:
            return (col + 1, BB_ROW_Y[hole[0]])
        return None
    rail = hole[:2]
    if rail in BB_RAILS and hole[2:].isdigit():
        col = int(hole[2:])
        if 1 <= col <= BB_COLS and col % 6 != 0:
            return (col + 1, BB_RAILS[rail])
    return None


def all_holes() -> list[str]:
    holes = [f"{r}{c}" for r in BB_ROW_Y for c in range(1, BB_COLS + 1)]
    holes += [f"{r}{c}" for r in BB_RAILS for c in range(1, BB_COLS + 1) if c % 6 != 0]
    return holes
