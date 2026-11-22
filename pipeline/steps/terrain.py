"""elevation.bin: Float32Array(rows*cols), metres a.s.l. = mean of the Copernicus GLO-30 DEM pixels whose
centres fall in each 60 m cell."""

from __future__ import annotations

import numpy as np

from . import grid, raster

# 1x1 degree tiles named by their lower-left corner (per event: grid.EVENT.dem_tiles); verified by reading
# their bounds, e.g. S34_00_W072 covers lat -34..-33, S33_00_W072 covers lat -33..-32 (both lon -72..-71).
URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_DEM/Copernicus_DSM_COG_10_{t}_DEM.tif"


def bake() -> dict:
    total = np.zeros(grid.N_CELLS)
    count = np.zeros(grid.N_CELLS)
    for t in grid.EVENT.dem_tiles:
        res = raster.read_bbox_4326(URL.format(t=t), f"dem_{t}")
        if res is None:
            raise RuntimeError(f"DEM tile {t} does not overlap the grid: fix the event's dem_tiles")
        a, lat, lon = res
        idx = raster.pixel_cells(lat, lon).ravel()
        v = a.astype(np.float64).ravel()
        ok = (idx >= 0) & np.isfinite(v) & (v > -1000)
        total += np.bincount(idx[ok], weights=v[ok], minlength=grid.N_CELLS)
        count += np.bincount(idx[ok], minlength=grid.N_CELLS)
    if (count == 0).any():
        raise RuntimeError(f"{int((count == 0).sum())} grid cells got no DEM sample")
    elev = (total / count).astype("<f4")
    elev.tofile(grid.OUT_DIR / "elevation.bin")
    return {
        "min_m": round(float(elev.min()), 1),
        "max_m": round(float(elev.max()), 1),
        "mean_m": round(float(elev.mean()), 1),
        "samples_per_cell": round(float(count.mean()), 1),
    }
