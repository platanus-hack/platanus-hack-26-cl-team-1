"""Base fuel classes per cell (FUEL codes, web/src/engine/types.ts), the input of steps/wui.py.

Majority ESA WorldCover 10 m v200 (2021) class per 60 m cell, mapped to the fuel classes; built-up cells
are split into dense / low by building footprint coverage, and vegetation cells that are mostly roofs
become dense urban. This roof-coverage split is NOT what ships: steps/wui.py re-splits every built-up
cell into intermix / consolidated by the vegetation around it and writes web/public/data/fuel.bin. Every
non-built-up cell keeps the class computed here.
"""

from __future__ import annotations

import numpy as np

from . import grid, raster

# FUEL enum in types.ts
NONE, GRASS, SHRUB, FOREST, CROP, URBAN_LOW, URBAN_DENSE = range(7)
FUEL_NAMES = ["NONE", "GRASS", "SHRUB", "FOREST", "CROP", "URBAN_LOW", "URBAN_DENSE"]
VEGETATION = (GRASS, SHRUB, FOREST, CROP)
URBAN_MARK = 50  # WorldCover "built-up"; split after binning

WORLDCOVER_TO_FUEL = {
    10: FOREST,  # tree cover
    20: SHRUB,  # shrubland
    30: GRASS,  # grassland
    40: CROP,  # cropland
    50: URBAN_MARK,  # built-up
    60: NONE,  # bare / sparse vegetation
    70: NONE,  # snow and ice
    80: NONE,  # permanent water bodies
    90: GRASS,  # herbaceous wetland
    95: FOREST,  # mangroves
    100: GRASS,  # moss and lichen
}
WC_CLASSES = sorted(WORLDCOVER_TO_FUEL)  # nodata (0) is not a class: it never wins the majority

# 3x3 degree tiles named by their lower-left corner; the grid straddles lat -33.
TILES = ["S36W072", "S33W072"]
URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"

DENSE_URBAN_COVERAGE = 0.15  # built-up cell with >= 15% roof coverage -> URBAN_DENSE, else URBAN_LOW
VEG_TO_DENSE_COVERAGE = 0.25  # vegetation cell with >= 25% roof coverage -> URBAN_DENSE


def class_counts() -> np.ndarray:
    """WorldCover pixel count per cell and class (int64, N_CELLS x len(WC_CLASSES), columns in WC_CLASSES
    order). Raises if a cell has no valid pixel."""
    lut = np.full(256, -1, dtype=np.int64)
    for i, c in enumerate(WC_CLASSES):
        lut[c] = i
    k = len(WC_CLASSES)
    counts = np.zeros(grid.N_CELLS * k, dtype=np.int64)
    for t in TILES:
        res = raster.read_bbox_4326(URL.format(t=t), f"worldcover_{t}")
        if res is None:
            raise RuntimeError(f"WorldCover tile {t} does not overlap the grid: fix TILES")
        a, lat, lon = res
        idx = raster.pixel_cells(lat, lon).ravel()
        cls = lut[a.ravel()]
        bad = (cls < 0) & (a.ravel() != 0)
        if bad.any():
            raise RuntimeError(f"WorldCover tile {t}: unknown class values {np.unique(a.ravel()[bad])}")
        ok = (idx >= 0) & (cls >= 0)
        counts += np.bincount(idx[ok] * k + cls[ok], minlength=grid.N_CELLS * k)
    counts = counts.reshape(grid.N_CELLS, k)
    empty = counts.sum(axis=1) == 0
    if empty.any():
        raise RuntimeError(f"{int(empty.sum())} grid cells got no WorldCover pixel")
    return counts


def majority_classes(counts: np.ndarray) -> np.ndarray:
    """Majority WorldCover class per cell (uint8, N_CELLS) from class_counts()."""
    return np.array(WC_CLASSES, dtype=np.uint8)[counts.argmax(axis=1)]


def base_fuel(wc_major: np.ndarray) -> np.ndarray:
    """Pure: majority WorldCover class -> FUEL code, with built-up left as URBAN_MARK for the caller to split.
    Raises on a class that has no mapping."""
    lut = np.full(256, 255, dtype=np.uint8)
    for wc, f in WORLDCOVER_TO_FUEL.items():
        lut[wc] = f
    fuel = lut[wc_major]
    if (fuel == 255).any():
        raise ValueError(f"unmapped WorldCover classes: {np.unique(wc_major[fuel == 255])}")
    return fuel


def classify(wc_major: np.ndarray, coverage: np.ndarray) -> np.ndarray:
    """Pure mapping (unit-tested): majority WorldCover class + roof coverage -> FUEL code."""
    fuel = base_fuel(wc_major)
    urban = fuel == URBAN_MARK
    fuel[urban] = np.where(coverage[urban] >= DENSE_URBAN_COVERAGE, URBAN_DENSE, URBAN_LOW)
    veg = np.isin(fuel, VEGETATION) & (coverage >= VEG_TO_DENSE_COVERAGE)
    fuel[veg] = URBAN_DENSE
    return fuel


def bake(counts: np.ndarray, coverage: np.ndarray) -> tuple[np.ndarray, dict]:
    """counts: class_counts(); coverage: buildings.coverage(). Returns the roof-coverage classes (not
    written: steps/wui.py writes fuel.bin from them)."""
    fuel = classify(majority_classes(counts), coverage)
    hist = np.bincount(fuel, minlength=7)
    ha = grid.CELL_M * grid.CELL_M / 10000
    return fuel, {FUEL_NAMES[i]: f"{int(hist[i])} cells ({hist[i] * ha:,.0f} ha)" for i in range(7)}
