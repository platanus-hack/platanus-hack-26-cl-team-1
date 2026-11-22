"""scar.bin: Uint8Array(rows*cols): 1 burned, 0 not burned, 255 no data. Sentinel-2 L2A dNBR burn scar.

Method:
  * Pre- and post-fire scenes per event (grid.EVENT.s2_pre / s2_post; Viña: S2B 19HBD 2024-01-18, 0.62 %
    cloud, and S2A 19HBD 2024-02-12, 0.06 % cloud), from the Element84 Earth Search STAC (COGs on AWS, read
    by window via /vsicurl/).
  * Reflectance = DN * 0.0001 + grid.EVENT.scar_offset. Earth Search COGs already have the baseline-04.00
    +1000 offset removed, so the true surface reflectance is DN * 0.0001 (offset 0.0, used by new events).
    Viña's shipped scar used -0.1, which makes 15-20 % of its valid pixels negative; it is kept for Viña so
    its scar and everything calibrated on it stay unchanged. The bake reports the share of valid pixels
    that come out negative and stops above grid.EVENT.scar_max_negative_share. The STAC flag
    `earthsearch:boa_offset_applied` is not used here: Eaton's post-fire scene says false, but its pixels are
    offset-free (with -0.1, 27 % would be negative). B08 (10 m) is averaged to the 20 m grid of B12 / SCL.
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
    on the event's fire days (grid.EVENT.scar_firms_days; Viña: 2-3 Feb 2024) are kept; other changes
    between the two dates (unrelated fires, harvests) are dropped and their hectares reported.
  * The post-fire scene is after the fire (Viña: 10 days later): the scar is the FINAL footprint of the
    whole event, not the state at any given hour.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import grid

COG = (
    "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/{zone}/{band_letter}/{square}/{y}/{m}/{id}/"
    "{band}.tif"
)
SCALE = 0.0001
DNBR_BURNED = 0.27
DNBR_BURNED_URBAN = 0.15
URBAN_FUELS = (5, 6)  # FUEL.URBAN_LOW, FUEL.URBAN_DENSE
MIN_PATCH_PX = 9  # 9 x 400 m2 = 0.36 ha
SCL_INVALID = [0, 1, 3, 6, 8, 9, 10, 11]
FIRMS_RADIUS_M = 400  # about one VIIRS 375 m pixel
STAC_ITEM = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{id}"


def _url(scene_id: str, band: str) -> str:
    """COG of one band of an Earth Search scene id like S2B_19HBD_20240118_0_L2A (MGRS tile 19HBD)."""
    _, tile, date = scene_id.split("_")[:3]
    if len(tile) not in (5, 6) or len(date) != 8:
        raise ValueError(f"not a Sentinel-2 Earth Search scene id: {scene_id!r}")
    return COG.format(
        zone=int(tile[:-3]),
        band_letter=tile[-3],
        square=tile[-2:],
        y=date[:4],
        m=int(date[4:6]),
        id=scene_id,
        band=band,
    )


def scene_props(scene_id: str) -> dict:
    """STAC item properties of a scene (cached)."""
    import json

    cache = grid.CACHE_DIR / f"stac_{scene_id}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    import requests

    r = requests.get(STAC_ITEM.format(id=scene_id), timeout=60)
    r.raise_for_status()
    props = r.json()["properties"]
    cache.write_text(json.dumps(props, indent=1))
    return props


def boa_offset(scene_id: str) -> float:
    """Additive offset to apply after DN * 0.0001 to get surface reflectance, from the scene's STAC item.

    Processing baseline >= 04.00 stores DN = 10000 * reflectance + 1000 (BOA_ADD_OFFSET, see
    https://sentinels.copernicus.eu/-/copernicus-sentinel-2-major-products-upgrade-upcoming); Earth Search
    re-writes those COGs without the +1000 and says so with `earthsearch:boa_offset_applied: true`. Applying
    -0.1 again to such a COG gives negative red reflectance over vegetation (NDVI > 1), so the item is
    checked, not assumed (steps/wui.py re-checks the result on the pixels)."""
    props = scene_props(scene_id)
    baseline = props.get("s2:processing_baseline")
    applied = props.get("earthsearch:boa_offset_applied")
    if baseline is None:
        raise RuntimeError(f"{scene_id}: STAC item has no s2:processing_baseline")
    if baseline < "04.00" or applied is True:
        return 0.0
    if applied is False:
        return -0.1
    raise RuntimeError(f"{scene_id}: baseline {baseline} but earthsearch:boa_offset_applied is {applied!r}")


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
        pad = grid.EVENT.s2_window_pad_m
        f = from_bounds(w - pad, s - pad, e + pad, n + pad, ds.transform)
        win = Window(int(f.col_off), int(f.row_off), int(np.ceil(f.width)), int(np.ceil(f.height)))
        # The pad is a margin, not a requirement: clip it to the tile (bake() still raises if a grid cell gets
        # no pixel). A no-op when the window is inside the tile (Viña).
        c0, r0 = max(win.col_off, 0), max(win.row_off, 0)
        c1, r1 = min(win.col_off + win.width, ds.width), min(win.row_off + win.height, ds.height)
        win = Window(c0, r0, c1 - c0, r1 - r0)
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


def _nbr(sc: dict[str, np.ndarray], offset: float) -> np.ndarray:
    nir = sc["b08"].astype(np.float64) * SCALE + offset
    swir = sc["b12"].astype(np.float64) * SCALE + offset
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
    ev = grid.EVENT
    pre, post = _read_scene(ev.s2_pre), _read_scene(ev.s2_post)
    if pre["b12"].shape != post["b12"].shape or not np.allclose(pre["transform"], post["transform"]):
        raise RuntimeError("pre and post scenes are not on the same pixel grid")
    valid = ~np.isin(pre["scl"], SCL_INVALID) & ~np.isin(post["scl"], SCL_INVALID)
    neg = {}
    for name, sc in (("pre", pre), ("post", post)):
        ok = ~np.isin(sc["scl"], SCL_INVALID)
        refl_neg = (sc["b08"] * SCALE + ev.scar_offset < 0) | (sc["b12"] * SCALE + ev.scar_offset < 0)
        neg[name] = float(refl_neg[ok].mean())
        if neg[name] > ev.scar_max_negative_share:
            raise RuntimeError(
                f"scar: {neg[name]:.1%} of the valid {name}-fire pixels have negative reflectance with offset "
                f"{ev.scar_offset} (limit {ev.scar_max_negative_share:.0%}): wrong offset for these COGs"
            )
    dnbr = _nbr(pre, ev.scar_offset) - _nbr(post, ev.scar_offset)
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

    days = ev.scar_firms_days
    viirs = [p for p in firms_points if p["satellite"].startswith("VIIRS") and p["timeLocal"][:10] in days]
    fc = grid.cell_index(np.array([p["lon"] for p in viirs]), np.array([p["lat"] for p in viirs]))
    fc = fc[fc >= 0]
    if len(fc) == 0:
        raise RuntimeError(f"no VIIRS detections on {days} inside the grid: cannot filter the scar")
    raw = burned_cell.reshape(grid.ROWS, grid.COLS)
    kept = keep_firms_connected(raw, fc, int(round(FIRMS_RADIUS_M / grid.CELL_M)))

    # Agreement check: share of the fire-day VIIRS detections that fall within FIRMS_RADIUS_M of the scar.
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
        "negative_reflectance_share": {k: f"{v:.1%}" for k, v in neg.items()},
        f"viirs_{days[0]}..{days[-1]}_within_400m_of_scar": f"{agree:.1%} of {len(fc)}",
    }
