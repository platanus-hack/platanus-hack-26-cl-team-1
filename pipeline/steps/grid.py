"""The fixed simulation grid shared with web/src/engine/types.ts (GridMeta).

Row 0 is the NORTH edge, col 0 the WEST edge, row-major (index = r * cols + c).
Cell (r, c) centre: lat = LAT_MAX - (r + 0.5) * D_LAT, lon = LON_MIN + (c + 0.5) * D_LON.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

LAT_MAX = -32.965
LON_MIN = -71.625
CELL_M = 60
D_LAT = 60 / 111320
D_LON = 60 / (111320 * math.cos(math.radians(33.09)))
ROWS = 464
COLS = 529
T0 = "2024-02-02T12:00:00-03:00"

LAT_MIN = LAT_MAX - ROWS * D_LAT
LON_MAX = LON_MIN + COLS * D_LON
N_CELLS = ROWS * COLS

PIPELINE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
OUT_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"


def bbox() -> tuple[float, float, float, float]:
    """(west, south, east, north) in degrees."""
    return (LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)


def cell_index(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Flat cell index per point; -1 for points outside the grid."""
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    c = np.floor((lon - LON_MIN) / D_LON).astype(np.int64)
    r = np.floor((LAT_MAX - lat) / D_LAT).astype(np.int64)
    inside = (r >= 0) & (r < ROWS) & (c >= 0) & (c < COLS)
    return np.where(inside, r * COLS + c, -1)


def cell_centres() -> tuple[np.ndarray, np.ndarray]:
    """(lon, lat) of every cell centre, each shaped (ROWS, COLS)."""
    lat = LAT_MAX - (np.arange(ROWS) + 0.5) * D_LAT
    lon = LON_MIN + (np.arange(COLS) + 0.5) * D_LON
    return np.meshgrid(lon, lat)


def grid_meta(sources: dict[str, str]) -> dict:
    return {
        "rows": ROWS,
        "cols": COLS,
        "latMax": LAT_MAX,
        "lonMin": LON_MIN,
        "dLat": D_LAT,
        "dLon": D_LON,
        "cellM": CELL_M,
        "t0": T0,
        "sources": sources,
    }


def bin_mean(lon: np.ndarray, lat: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean of `values` over the points whose coordinates fall in each cell, and the point count per
    cell. Cells with no point get NaN mean and count 0."""
    idx = cell_index(lon, lat)
    keep = idx >= 0
    idx = idx[keep]
    v = np.asarray(values, dtype=np.float64)[keep]
    count = np.bincount(idx, minlength=N_CELLS)
    total = np.bincount(idx, weights=v, minlength=N_CELLS)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    return mean, count


def haversine_m(lon1, lat1, lon2, lat2):
    """Great-circle distance in metres (vectorised)."""
    r = 6371008.8
    p1 = np.radians(lat1)
    p2 = np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))
