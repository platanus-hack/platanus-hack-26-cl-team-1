"""Reads windows of remote EPSG:4326 COGs (via GDAL /vsicurl/) and bins their pixels onto the grid."""

from __future__ import annotations

import math
import os

import numpy as np

from . import grid

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")


def read_bbox_4326(url: str, cache_name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Read the part of a geographic (EPSG:4326, north-up) raster that overlaps the grid.

    Returns (band1 array, latitude of each row centre, longitude of each column centre), or None if
    the raster does not overlap the grid. Cached as .npz in the download cache."""
    cache = grid.CACHE_DIR / f"{cache_name}.npz"
    if cache.exists():
        z = np.load(cache)
        return z["a"], z["lat"], z["lon"]

    import rasterio
    from rasterio.windows import Window, from_bounds

    with rasterio.open("/vsicurl/" + url) as ds:
        if ds.crs is None or ds.crs.to_epsg() != 4326:
            raise RuntimeError(f"{url}: expected EPSG:4326, got {ds.crs}")
        b = ds.bounds
        w, s, e, n = grid.bbox()
        w, s, e, n = max(w, b.left), max(s, b.bottom), min(e, b.right), min(n, b.top)
        if w >= e or s >= n:
            return None
        f = from_bounds(w, s, e, n, ds.transform)
        r0, c0 = math.floor(f.row_off), math.floor(f.col_off)
        r1, c1 = math.ceil(f.row_off + f.height), math.ceil(f.col_off + f.width)
        win = Window(c0, r0, c1 - c0, r1 - r0)
        a = ds.read(1, window=win)
        t = ds.window_transform(win)
        if t.b != 0 or t.d != 0 or t.e >= 0:
            raise RuntimeError(f"{url}: raster is not north-up")
    lat = t.f + (np.arange(a.shape[0]) + 0.5) * t.e
    lon = t.c + (np.arange(a.shape[1]) + 0.5) * t.a
    np.savez_compressed(cache, a=a, lat=lat, lon=lon)
    return a, lat, lon


def pixel_cells(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """2-D flat cell index for a raster with the given row-centre latitudes and column-centre
    longitudes; -1 where the pixel centre is outside the grid."""
    r = np.floor((grid.LAT_MAX - lat) / grid.D_LAT).astype(np.int64)
    c = np.floor((lon - grid.LON_MIN) / grid.D_LON).astype(np.int64)
    rv = (r >= 0) & (r < grid.ROWS)
    cv = (c >= 0) & (c < grid.COLS)
    idx = r[:, None] * grid.COLS + c[None, :]
    return np.where(rv[:, None] & cv[None, :], idx, -1)
