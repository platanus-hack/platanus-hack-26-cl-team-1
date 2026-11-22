"""Pre-fire wildland-urban interface (WUI) features per cell, and the shipped fuel layer built from them.

Writes
  web/public/data/fuel.bin      Uint8 (rows*cols): FUEL codes (web/src/engine/types.ts). Built-up cells are
                                URBAN_LOW (intermix) or URBAN_DENSE (consolidated) by the rule below; every
                                other cell keeps the class of steps/fuel.py.
  pipeline/.cache/wui_*.bin     Little-endian float32 (rows*cols) feature rasters, for analysis/calibration.

Why. fuel.bin splits built-up cells by roof coverage only, so a hillside neighbourhood of houses among
eucalyptus quebradas and a consolidated, paved city block with the same roof coverage get the same class.
In the 2024 fire the first kind burned and the second mostly did not. This layer splits built-up cells by
how much vegetation surrounds them instead: intermix (URBAN_LOW, burns) vs consolidated (URBAN_DENSE).

Inputs are PRE-FIRE only: ESA WorldCover 2021 (10 m), Overture buildings, Sentinel-2 L2A of 2024-01-18
(15 days before the fire: B04/B08 at 10 m, SCL at 20 m) and the Copernicus GLO-30 elevation. The burn
scar and the FIRMS detections are never read here (they are used only to score the result).

Rule (classify_wui; every threshold is a constant below):
  1. green(cell) = max(WorldCover vegetation share, share of 10 m pixels with NDVI > NDVI_GREEN), i.e. a
     lower bound of the share of the cell that is vegetation by either source. WorldCover counts cured
     grass, which summer NDVI misses; NDVI counts garden trees and quebrada canopy that WorldCover's
     10 m classifier often labels built-up. Where Sentinel-2 has no valid pixel (sea, lake, cloud), the
     WorldCover share alone is used and the cells are counted in the summary.
  2. neighbourhood green = mean of green over a disk of GREEN_RADIUS_CELLS (180 m) around the cell, with
     cells outside the grid left out of the mean (no edge padding).
  3. Built-up cells are WorldCover built-up majority cells, plus vegetation-majority cells whose roof
     coverage is >= VEG_TO_URBAN_COVERAGE (the same 25 % fuel.py uses).
  4. Built-up cell with neighbourhood green >= INTERMIX_GREEN -> URBAN_LOW (intermix), else URBAN_DENSE
     (consolidated: little vegetation, spread only structure to structure). Roof coverage no longer
     decides between them.
  5. Every other cell keeps the class it has in fuel.bin (vegetation classes, NONE).
The idea follows the usual WUI definitions, which call "intermix" the places where houses sit among more
than 50 % wildland vegetation (SILVIS / Radeloff et al. 2005:
https://www.fs.usda.gov/rds/archive/products/RDS-2015-0012-3/_metadata_RDS-2015-0012-3.html), measured
around each building in the building-based version (USGS, Carlson et al. 2022:
https://www.usgs.gov/data/wildland-urban-interface-maps-conterminous-us-based-125-million-building-locations).
Here the threshold is 40 % because green is a lower bound of the vegetated share (step 1).
Disclosure: the green definition (WorldCover, NDVI or their max), the radius (60-180 m) and the threshold
(30-50 %) were also compared against the scar, as global scalars, among about 20 candidates; the score is
flat over that range (+-20 % on the threshold or 120 / 240 m radius change Dice by < 0.002).
Slope is computed and cached but deliberately not used: the fire engine already applies slope to the
rate of spread (x2 per 10 deg), so putting it in the fuel class too would count it twice.
"""

from __future__ import annotations

import json

import numpy as np
from scipy import ndimage

from . import fuel as fuel_step
from . import grid
from .scar import SCENES, SCL_INVALID, _lonlat_of_pixels, _read_scene, _url

# --- Rule parameters (one place; documented in pipeline/README.md) -------------------------------------------
VEG_WC_CLASSES = (10, 20, 30, 40, 90, 95, 100)  # tree, shrub, grass, crop, wetland, mangrove, moss/lichen
NDVI_GREEN = 0.30  # a 10 m pixel is green vegetation if its pre-fire NDVI is above this
GREEN_RADIUS_CELLS = 3  # neighbourhood disk radius: 3 cells = 180 m (29 cells)
INTERMIX_GREEN = 0.40  # built-up cell with neighbourhood green >= 40 % -> URBAN_LOW (intermix)
VEG_TO_URBAN_COVERAGE = fuel_step.VEG_TO_DENSE_COVERAGE  # vegetation cell with >= 25 % roofs counts as built-up

STAC_ITEM = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{id}"
S2_SCALE = 0.0001
MAX_NEGATIVE_REFLECTANCE_SHARE = 0.01  # sanity check on the BOA offset (see ndvi_features)


def _boa_offset(scene_id: str) -> float:
    """Additive offset to apply after DN * S2_SCALE, read from the scene's STAC item (cached).

    Processing baseline >= 04.00 stores DN = 10000 * reflectance + 1000 (BOA_ADD_OFFSET, see
    https://sentinels.copernicus.eu/-/copernicus-sentinel-2-major-products-upgrade-upcoming); Earth Search
    re-writes those COGs without the +1000 and says so with `earthsearch:boa_offset_applied: true`. Applying
    -0.1 again to such a COG gives negative red reflectance over vegetation (NDVI > 1), so the item is
    checked, not assumed, and ndvi_features re-checks the result on the pixels."""
    cache = grid.CACHE_DIR / f"stac_{scene_id}.json"
    if cache.exists():
        props = json.loads(cache.read_text())
    else:
        import requests

        r = requests.get(STAC_ITEM.format(id=scene_id), timeout=60)
        r.raise_for_status()
        props = r.json()["properties"]
        cache.write_text(json.dumps(props, indent=1))
    baseline = props.get("s2:processing_baseline")
    applied = props.get("earthsearch:boa_offset_applied")
    if baseline is None:
        raise RuntimeError(f"{scene_id}: STAC item has no s2:processing_baseline")
    if baseline < "04.00" or applied is True:
        return 0.0
    if applied is False:
        return -0.1
    raise RuntimeError(f"{scene_id}: baseline {baseline} but earthsearch:boa_offset_applied is {applied!r}")


def _read_10m(scene_id: str) -> dict[str, np.ndarray]:
    """B04 and B08 (10 m) over the same window as the scene's cached 20 m bands (scar._read_scene), so that
    10 m pixel (r, c) lies inside 20 m pixel (r // 2, c // 2). Cached as .npz."""
    cache = grid.CACHE_DIR / f"s2_10m_{scene_id}.npz"
    if cache.exists():
        z = np.load(cache)
        return {k: z[k] for k in z.files}

    import rasterio
    from rasterio.windows import Window, from_bounds

    from . import raster  # noqa: F401 - sets the GDAL HTTP options

    s20 = _read_scene(scene_id)
    a, _, x0, _, e, y0 = s20["transform"]
    h, w = s20["b12"].shape
    bounds = (x0, y0 + h * e, x0 + w * a, y0)
    out: dict[str, np.ndarray] = {}
    for band in ("B04", "B08"):
        with rasterio.open("/vsicurl/" + _url(scene_id, band)) as ds:
            f = from_bounds(*bounds, ds.transform)
            win = Window(round(f.col_off), round(f.row_off), round(f.width), round(f.height))
            out[band.lower()] = ds.read(1, window=win)
            out["transform"] = np.array(ds.window_transform(win)[:6])
    t = out["transform"]
    if out["b04"].shape != (2 * h, 2 * w) or not np.allclose([t[2], t[5]], [x0, y0]):
        raise RuntimeError(f"{scene_id}: 10 m window {out['b04'].shape} at {t[2]},{t[5]} does not match the 20 m one")
    np.savez_compressed(cache, **out)
    return out


def ndvi_features(scene_id: str) -> tuple[np.ndarray, np.ndarray]:
    """(mean NDVI, share of pixels with NDVI > NDVI_GREEN) per cell over the valid 10 m pixels whose centres
    fall in it; NaN where a cell has no valid pixel. Invalid = SCL (20 m, same scene) in SCL_INVALID, or
    no data in B04/B08."""
    s10 = _read_10m(scene_id)
    s20 = _read_scene(scene_id)
    off = _boa_offset(scene_id)
    red = s10["b04"].astype(np.float64) * S2_SCALE + off
    nir = s10["b08"].astype(np.float64) * S2_SCALE + off
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (nir - red) / (nir + red)
    scl = np.repeat(np.repeat(s20["scl"], 2, axis=0), 2, axis=1)
    valid = ~np.isin(scl, SCL_INVALID) & (s10["b04"] > 0) & (s10["b08"] > 0) & np.isfinite(ndvi)
    # The STAC flag is not always reliable (https://github.com/sertit/eoreader/discussions/120): check the data.
    # With the right offset, reflectance is never meaningfully negative; an offset applied twice makes most
    # red pixels negative.
    neg = float(((red < 0) | (nir < 0))[valid].mean())
    if neg > MAX_NEGATIVE_REFLECTANCE_SHARE:
        raise RuntimeError(f"{scene_id}: {neg:.1%} of valid pixels have negative reflectance with offset {off}")
    lon, lat = _lonlat_of_pixels(s10["transform"], str(s20["crs"]), ndvi.shape)
    idx = grid.cell_index(lon, lat)
    ok = (idx >= 0) & valid.ravel()
    v = ndvi.ravel()[ok]
    n = np.bincount(idx[ok], minlength=grid.N_CELLS)
    total = np.bincount(idx[ok], weights=v, minlength=grid.N_CELLS)
    green = np.bincount(idx[ok], weights=v > NDVI_GREEN, minlength=grid.N_CELLS)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, total / n, np.nan), np.where(n > 0, green / n, np.nan)


def vegetation_share(counts: np.ndarray) -> np.ndarray:
    """Pure: share (0..1) of a cell's valid WorldCover pixels in VEG_WC_CLASSES, from fuel.class_counts()."""
    cols = [fuel_step.WC_CLASSES.index(c) for c in VEG_WC_CLASSES]
    return counts[:, cols].sum(axis=1) / counts.sum(axis=1)


def slope_deg(elev: np.ndarray, cell_m: float) -> np.ndarray:
    """Pure: slope in degrees of a (rows, cols) elevation raster by central differences (one-sided at the
    edges), cells treated as square cell_m, like the fire engine."""
    gy, gx = np.gradient(elev.astype(np.float64), cell_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def neighbourhood_green(vegfrac: np.ndarray, ndvi_green: np.ndarray, shape: tuple[int, int], radius: int) -> np.ndarray:
    """Pure: disk mean (radius in cells) of max(vegfrac, ndvi_green); NaN ndvi_green -> vegfrac alone.
    Cells outside the raster are left out of the mean (normalised convolution, no padding)."""
    g = np.maximum(vegfrac, np.nan_to_num(ndvi_green, nan=0.0)).reshape(shape)
    yy, xx = np.mgrid[-radius : radius + 1, -radius : radius + 1]
    k = ((xx * xx + yy * yy) <= radius * radius).astype(np.float64)
    num = ndimage.convolve(g, k, mode="constant", cval=0.0)
    den = ndimage.convolve(np.ones(shape), k, mode="constant", cval=0.0)
    return (num / den).ravel()


def classify_wui(wc_major: np.ndarray, coverage: np.ndarray, green: np.ndarray) -> np.ndarray:
    """Pure mapping (unit-tested): majority WorldCover class, roof coverage and neighbourhood green share
    -> FUEL code (see the module docstring)."""
    out = fuel_step.base_fuel(wc_major)
    built = (out == fuel_step.URBAN_MARK) | (np.isin(out, fuel_step.VEGETATION) & (coverage >= VEG_TO_URBAN_COVERAGE))
    out[built] = np.where(green[built] >= INTERMIX_GREEN, fuel_step.URBAN_LOW, fuel_step.URBAN_DENSE)
    return out


def _f32(name: str, a: np.ndarray) -> None:
    np.asarray(a, dtype="<f4").tofile(grid.CACHE_DIR / f"wui_{name}.bin")


def bake(counts: np.ndarray, bld: np.ndarray, fuel_codes: np.ndarray) -> tuple[np.ndarray, dict]:
    """counts: fuel.class_counts(); bld: buildings.load() array; fuel_codes: the roof-coverage classes of
    fuel.bake (for the summary only). Needs elevation.bin already written by the terrain step."""
    vegfrac = vegetation_share(counts)
    bidx = grid.cell_index(bld[:, 0], bld[:, 1])
    if (bidx < 0).any():
        raise RuntimeError("wui: buildings outside the grid (buildings.load() should have dropped them)")
    bcount = np.bincount(bidx, minlength=grid.N_CELLS)
    coverage = np.bincount(bidx, weights=bld[:, 2], minlength=grid.N_CELLS) / (grid.CELL_M * grid.CELL_M)
    ndvi_mean, ndvi_green = ndvi_features(SCENES["pre"])
    elev = np.fromfile(grid.OUT_DIR / "elevation.bin", dtype="<f4")
    if elev.size != grid.N_CELLS:
        raise RuntimeError(f"elevation.bin has {elev.size} values, expected {grid.N_CELLS}: run the terrain step")
    slope = slope_deg(elev.reshape(grid.ROWS, grid.COLS), grid.CELL_M).ravel()
    green = neighbourhood_green(vegfrac, ndvi_green, (grid.ROWS, grid.COLS), GREEN_RADIUS_CELLS)
    wc_major = fuel_step.majority_classes(counts)
    out = classify_wui(wc_major, coverage, green)

    for name, a in (
        ("vegfrac", vegfrac),
        ("bcount", bcount),
        ("coverage", coverage),
        ("ndvi_mean", ndvi_mean),
        ("ndvi_green", ndvi_green),
        ("green_r180", green),
        ("slope_deg", slope),
    ):
        _f32(name, a)
    out.astype(np.uint8).tofile(grid.OUT_DIR / "fuel.bin")

    names = fuel_step.FUEL_NAMES
    h_old = np.bincount(fuel_codes, minlength=7)
    h_new = np.bincount(out, minlength=7)
    b_old = np.bincount(fuel_codes, weights=bcount, minlength=7).astype(int)
    b_new = np.bincount(out, weights=bcount, minlength=7).astype(int)
    return out, {
        "params": f"NDVI>{NDVI_GREEN}, radius {GREEN_RADIUS_CELLS * grid.CELL_M} m, intermix green >= "
        f"{INTERMIX_GREEN:.0%}, veg->built-up at roofs >= {VEG_TO_URBAN_COVERAGE:.0%}",
        "cells_without_valid_s2_pixel": int(np.isnan(ndvi_green).sum()),
        "cells roof-coverage split -> fuel.bin": {names[i]: f"{int(h_old[i])} -> {int(h_new[i])}" for i in range(7)},
        "buildings roof-coverage split -> fuel.bin": {names[i]: f"{b_old[i]} -> {b_new[i]}" for i in range(7)},
        "changed_cells": int((out != fuel_codes).sum()),
    }
