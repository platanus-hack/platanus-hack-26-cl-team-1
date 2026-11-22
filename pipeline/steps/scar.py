"""scar.bin: Uint8Array(rows*cols): 1 burned, 0 not burned, 255 no data. Sentinel-2 L2A dNBR burn scar.

Method:
  * Pre-fire scene S2B 19HBD 2024-01-18 (0.62 % cloud) and post-fire scene S2A 19HBD 2024-02-12 (0.06 %
    cloud), from the Element84 Earth Search STAC (COGs on AWS, read by window via /vsicurl/).
  * Surface reflectance = DN * 0.0001 - 0.1 (processing baseline 05.10). B08 (10 m) is averaged to the
    20 m grid of B12 / SCL.
  * NBR = (B08 - B12) / (B08 + B12); dNBR = NBR_pre - NBR_post; burned pixel if dNBR > 0.27.
    In built-up cells (fuel URBAN_LOW / URBAN_DENSE) the pixel threshold is 0.15: roofs and paving have
    a low pre-fire NBR, so a burned block cannot reach 0.27; in built-up cells far from the fire 95 % of
    pixels have dNBR < 0.08 and 99 % < 0.18 (measured), so 0.15 + the >50 % cell rule stays specific.
  * Invalid pixel if SCL (either scene) is no data, saturated, cloud shadow, water, cloud or snow. SCL 2
    (dark area) is kept on purpose: fresh burn scars are often classified as dark area.
  * Speckle cleanup with a morphological area opening: 8-connected burned-pixel patches smaller than
    MIN_PATCH_PX (0.36 ha, one grid cell) are removed. (A 3x3 binary opening was tried first: it also
    eroded every burn edge and removed ~840 ha of real scar.)
  * Per grid cell: no data (255) if fewer than half of its 20 m pixels are valid, else burned (1) if the
    burned fraction of its valid pixels is > 0.5.
  * Only burned patches (8-connected, on the grid) that come within FIRMS_RADIUS_M of a VIIRS detection
    from 2-3 Feb 2024 are kept; other changes between the two dates (unrelated fires, harvests) are
    dropped and their hectares reported.
  * The post-fire scene is 10 days later: the scar is the FINAL footprint of the whole event (2-4 Feb),
    not the state at any given hour.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import grid

SCENES = {
    "pre": "S2B_19HBD_20240118_0_L2A",
    "post": "S2A_19HBD_20240212_0_L2A",
}
COG = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/19/H/BD/{y}/{m}/{id}/{band}.tif"
SCALE, OFFSET = 0.0001, -0.1
DNBR_BURNED = 0.27
DNBR_BURNED_URBAN = 0.15
URBAN_FUELS = (5, 6)  # FUEL.URBAN_LOW, FUEL.URBAN_DENSE
MIN_PATCH_PX = 9  # 9 x 400 m2 = 0.36 ha
SCL_INVALID = [0, 1, 3, 6, 8, 9, 10, 11]
FIRMS_RADIUS_M = 400  # about one VIIRS 375 m pixel
FIRMS_DAYS = ("2024-02-02", "2024-02-03")
SOURCE = (
    "Copernicus Sentinel-2 L2A (ESA), escenas S2B 2024-01-18 y S2A 2024-02-12, tile 19HBD, vía Element84 "
    "Earth Search (https://earth-search.aws.element84.com/v1). dNBR > 0.27 (0.15 en zonas urbanas). Huella final del evento (2-4 feb). Contiene datos Copernicus "
    "Sentinel modificados (2024), licencia abierta Copernicus."
)


def _url(scene_id: str, band: str) -> str:
    date = scene_id.split("_")[2]
    return COG.format(y=date[:4], m=int(date[4:6]), id=scene_id, band=band)


def _read_scene(scene_id: str) -> dict[str, np.ndarray]:
    cache = grid.CACHE_DIR / f"s2_{scene_id}.npz"
    if cache.exists():
        z = np.load(cache)
        return {k: z[k] for k in z.files}

    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window, from_bounds

    from . import raster  # noqa: F401 - sets the GDAL HTTP options

    out: dict[str, np.ndarray] = {}
    with rasterio.open("/vsicurl/" + _url(scene_id, "B12")) as ds:
        w, s, e, n = transform_bounds("EPSG:4326", ds.crs, *grid.bbox(), densify_pts=21)
        pad = 200
        f = from_bounds(w - pad, s - pad, e + pad, n + pad, ds.transform)
        win = Window(int(f.col_off), int(f.row_off), int(np.ceil(f.width)), int(np.ceil(f.height)))
        out["b12"] = ds.read(1, window=win)
        t = ds.window_transform(win)
        crs = ds.crs.to_wkt()
        bounds = rasterio.windows.bounds(win, ds.transform)
        b12_transform = ds.transform
    with rasterio.open("/vsicurl/" + _url(scene_id, "SCL")) as ds:
        if ds.transform != b12_transform:
            raise RuntimeError("SCL and B12 grids differ")
        out["scl"] = ds.read(1, window=win)
    with rasterio.open("/vsicurl/" + _url(scene_id, "B08")) as ds:
        w10 = from_bounds(*bounds, ds.transform)
        w10 = Window(round(w10.col_off), round(w10.row_off), round(w10.width), round(w10.height))
        out["b08"] = ds.read(1, window=w10, out_shape=out["b12"].shape, resampling=Resampling.average)
    out["transform"] = np.array(t[:6])
    out["crs"] = np.array(crs)
    np.savez_compressed(cache, **out)
    return out


def _lonlat_of_pixels(transform: np.ndarray, crs: str, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    from rasterio.warp import transform as warp_transform

    a, b, c, d, e, f = transform
    rows, cols = np.mgrid[0 : shape[0], 0 : shape[1]]
    x = c + (cols + 0.5) * a + (rows + 0.5) * b
    y = f + (cols + 0.5) * d + (rows + 0.5) * e
    lon, lat = warp_transform(crs, "EPSG:4326", x.ravel(), y.ravel())
    return np.asarray(lon), np.asarray(lat)


def _nbr(sc: dict[str, np.ndarray]) -> np.ndarray:
    nir = sc["b08"].astype(np.float64) * SCALE + OFFSET
    swir = sc["b12"].astype(np.float64) * SCALE + OFFSET
    with np.errstate(invalid="ignore", divide="ignore"):
        return (nir - swir) / (nir + swir)


def remove_small_patches(mask: np.ndarray, min_px: int) -> np.ndarray:
    """Pure (unit-tested): area opening, drop 8-connected True patches with fewer than min_px pixels."""
    labels, _ = ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))
    size = np.bincount(labels.ravel())
    keep = size >= min_px
    keep[0] = False
    return keep[labels]


def keep_firms_connected(burned: np.ndarray, firms_cells: np.ndarray, radius_cells: int) -> np.ndarray:
    """Pure (unit-tested): keep the 8-connected burned patches of a (ROWS, COLS) bool mask that touch a
    disk of `radius_cells` around any of the given flat cell indices."""
    near = np.zeros(burned.size, dtype=bool)
    near[firms_cells] = True
    near = near.reshape(burned.shape)
    yy, xx = np.mgrid[-radius_cells : radius_cells + 1, -radius_cells : radius_cells + 1]
    near = ndimage.binary_dilation(near, structure=(xx * xx + yy * yy) <= radius_cells * radius_cells)
    labels, n = ndimage.label(burned, structure=np.ones((3, 3), dtype=bool))
    hit = np.unique(labels[near & burned])
    hit = hit[hit > 0]
    return np.isin(labels, hit)


def bake(firms_points: list[dict], fuel: np.ndarray) -> dict:
    pre, post = _read_scene(SCENES["pre"]), _read_scene(SCENES["post"])
    if pre["b12"].shape != post["b12"].shape or not np.allclose(pre["transform"], post["transform"]):
        raise RuntimeError("pre and post scenes are not on the same pixel grid")
    valid = ~np.isin(pre["scl"], SCL_INVALID) & ~np.isin(post["scl"], SCL_INVALID)
    dnbr = _nbr(pre) - _nbr(post)
    valid &= np.isfinite(dnbr)
    lon, lat = _lonlat_of_pixels(pre["transform"], str(pre["crs"]), pre["b12"].shape)
    idx = grid.cell_index(lon, lat)
    inside = idx >= 0
    urban_px = np.zeros(idx.size, dtype=bool)
    urban_px[inside] = np.isin(fuel[idx[inside]], URBAN_FUELS)
    threshold = np.where(urban_px.reshape(dnbr.shape), DNBR_BURNED_URBAN, DNBR_BURNED)
    burned_px = remove_small_patches(valid & (dnbr > threshold), MIN_PATCH_PX)

    total = np.bincount(idx[inside], minlength=grid.N_CELLS)
    nvalid = np.bincount(idx[inside], weights=valid.ravel()[inside], minlength=grid.N_CELLS)
    nburn = np.bincount(idx[inside], weights=burned_px.ravel()[inside], minlength=grid.N_CELLS)
    if (total == 0).any():
        raise RuntimeError(f"{int((total == 0).sum())} grid cells got no Sentinel-2 pixel")
    nodata = nvalid < 0.5 * total
    with np.errstate(invalid="ignore", divide="ignore"):
        burned_cell = ~nodata & (nburn / np.maximum(nvalid, 1) > 0.5)

    viirs = [p for p in firms_points if p["satellite"].startswith("VIIRS") and p["timeLocal"][:10] in FIRMS_DAYS]
    fc = grid.cell_index(np.array([p["lon"] for p in viirs]), np.array([p["lat"] for p in viirs]))
    fc = fc[fc >= 0]
    if len(fc) == 0:
        raise RuntimeError("no VIIRS detections for 2-3 Feb inside the grid: cannot filter the scar")
    raw = burned_cell.reshape(grid.ROWS, grid.COLS)
    kept = keep_firms_connected(raw, fc, int(round(FIRMS_RADIUS_M / grid.CELL_M)))

    # Agreement check: share of the 2-3 Feb VIIRS detections that fall within FIRMS_RADIUS_M of the scar.
    r = int(round(FIRMS_RADIUS_M / grid.CELL_M))
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    near_scar = ndimage.binary_dilation(kept, structure=(xx * xx + yy * yy) <= r * r).ravel()
    agree = float(near_scar[fc].mean())

    out = np.zeros(grid.N_CELLS, dtype=np.uint8)
    out[kept.ravel()] = 1
    out[nodata] = 255
    out.tofile(grid.OUT_DIR / "scar.bin")
    ha = grid.CELL_M * grid.CELL_M / 10000
    return {
        "burned_ha": round(float(kept.sum() * ha)),
        "burned_urban_ha": round(float((kept.ravel() & np.isin(fuel, URBAN_FUELS)).sum() * ha)),
        "dropped_unrelated_ha": round(float((raw & ~kept).sum() * ha)),
        "nodata_cells": int(nodata.sum()),
        "viirs_2-3feb_within_400m_of_scar": f"{agree:.1%} of {len(fc)}",
    }
