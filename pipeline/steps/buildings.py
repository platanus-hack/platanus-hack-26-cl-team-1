"""buildings.bin: Float32Array(n*3) = [lon, lat, footprintAreaM2] per building whose centroid is in the grid.

Primary source: Overture Maps buildings (anonymous S3, read with DuckDB + spatial, filtered on the bbox
struct columns). Fallback: current OSM buildings from the Overpass API (used only if Overture fails,
and the summary says so).
"""

from __future__ import annotations

import math
import time

import numpy as np

from . import grid, overpass

OVERTURE_RELEASE = "2026-11-18.0"
OVERTURE_URL = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*"
CACHE = grid.CACHE_DIR / f"buildings_overture_{OVERTURE_RELEASE}.npy"
CACHE_OSM = grid.CACHE_DIR / "buildings_osm.npy"

M_PER_DEG_LAT = 111320.0


def _deg2_to_m2(area_deg2: np.ndarray, lat: np.ndarray) -> np.ndarray:
    # Local equirectangular scale; error well under 1% at building scale.
    return area_deg2 * M_PER_DEG_LAT * M_PER_DEG_LAT * np.cos(np.radians(lat))


def _fetch_overture() -> np.ndarray:
    import duckdb

    w, s, e, n = grid.bbox()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")
    t = time.time()
    rows = con.execute(
        f"""
        SELECT ST_X(ST_Centroid(geometry)) AS lon, ST_Y(ST_Centroid(geometry)) AS lat,
               ST_Area(geometry) AS a
        FROM read_parquet('{OVERTURE_URL}', hive_partitioning = 1)
        WHERE bbox.xmax >= {w} AND bbox.xmin <= {e} AND bbox.ymax >= {s} AND bbox.ymin <= {n}
        """
    ).fetchnumpy()
    print(f"  overture query: {len(rows['lon'])} rows in {time.time() - t:.0f} s")
    lon = rows["lon"].astype(np.float64)
    lat = rows["lat"].astype(np.float64)
    area = _deg2_to_m2(rows["a"].astype(np.float64), lat)
    return np.stack([lon, lat, area], axis=1)


def _fetch_osm() -> np.ndarray:
    w, s, e, n = grid.bbox()
    q = f"[out:json][timeout:300];way[building]({s},{w},{n},{e});out geom;"
    data = overpass.query(q, grid.CACHE_DIR / "overpass_buildings.json")
    out = []
    for el in data["elements"]:
        g = el.get("geometry")
        if el["type"] != "way" or not g or len(g) < 4:
            continue
        lon = np.array([p["lon"] for p in g])
        lat = np.array([p["lat"] for p in g])
        # Shoelace in local metres around the first vertex.
        k = math.cos(math.radians(lat[0]))
        x = (lon - lon[0]) * M_PER_DEG_LAT * k
        y = (lat - lat[0]) * M_PER_DEG_LAT
        a = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
        out.append((lon[:-1].mean(), lat[:-1].mean(), a))
    return np.array(out, dtype=np.float64).reshape(-1, 3)


def load() -> tuple[np.ndarray, str]:
    """(n, 3) float64 array [lon, lat, areaM2] for buildings with centroid inside the grid, and the
    source label actually used."""
    if CACHE.exists():
        arr, src = np.load(CACHE), "overture"
    elif CACHE_OSM.exists():
        arr, src = np.load(CACHE_OSM), "osm"
    else:
        try:
            arr = _fetch_overture()
            np.save(CACHE, arr)
            src = "overture"
        except Exception as exc:  # noqa: BLE001 - the fallback is reported loudly in the summary
            print(f"  !! Overture failed ({type(exc).__name__}: {exc}); falling back to OSM Overpass")
            arr = _fetch_osm()
            np.save(CACHE_OSM, arr)
            src = "osm"
    inside = grid.cell_index(arr[:, 0], arr[:, 1]) >= 0
    arr = arr[inside]
    bad = ~np.isfinite(arr).all(axis=1) | (arr[:, 2] <= 0)
    if bad.any():
        print(f"  dropped {int(bad.sum())} buildings with empty / invalid geometry")
        arr = arr[~bad]
    if len(arr) == 0:
        raise RuntimeError("no buildings inside the grid: the building source returned nothing")
    # DuckDB scans in parallel, so row order varies between downloads: sort (north to south, then west
    # to east) so the output is byte-identical for the same data.
    arr = arr[np.lexsort((arr[:, 2], arr[:, 0], -arr[:, 1]))]
    return arr, src


def write(arr: np.ndarray) -> None:
    arr.astype("<f4").tofile(grid.OUT_DIR / "buildings.bin")


def coverage(arr: np.ndarray) -> np.ndarray:
    """Building footprint coverage per cell (0..>1): sum of footprint areas of buildings whose centroid
    is in the cell divided by the cell area. Float64 (N_CELLS,)."""
    idx = grid.cell_index(arr[:, 0], arr[:, 1])
    keep = idx >= 0
    total = np.bincount(idx[keep], weights=arr[keep, 2], minlength=grid.N_CELLS)
    return total / (grid.CELL_M * grid.CELL_M)
