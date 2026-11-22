"""perimeter.bin: Uint8Array(rows*cols), 1 inside the official final fire perimeter, 0 outside. VALIDATION ONLY:
the browser app does not load it; it is there to compare the Sentinel-2 scar and the simulated fire against an
official footprint.

Source (grid.EVENT.perimeter): the NIFC / WFIGS Interagency Fire Perimeters feature service (ArcGIS, public, no
key), queried for one fire by its unique fire id and the "Wildfire Final Fire Perimeter" category, as GeoJSON
in EPSG:4326, cached in the event's download cache. A cell is inside when its centre is inside the polygon
(rasterio.features.rasterize, all_touched=False).
"""

from __future__ import annotations

import json

import numpy as np
import requests

from . import grid

ACRE_M2 = 4046.8564224


def _download(spec: dict) -> dict:
    cache = grid.CACHE_DIR / "perimeter.geojson"
    if cache.exists():
        return json.loads(cache.read_text())
    params = {
        "where": f"attr_UniqueFireIdentifier = '{spec['unique_fire_id']}' AND poly_FeatureCategory = '{spec['category']}'",
        "outFields": "OBJECTID,poly_IncidentName,poly_GISAcres,poly_FeatureCategory,attr_UniqueFireIdentifier",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    r = requests.get(spec["url"] + "/query", params=params, timeout=120)
    r.raise_for_status()
    data = r.json()
    if "features" not in data:
        raise RuntimeError(f"perimeter: unexpected response from {spec['url']}: {str(data)[:300]}")
    cache.write_text(json.dumps(data))
    return data


def rasterize(geometry: dict) -> np.ndarray:
    """(N_CELLS,) uint8: 1 where the cell centre is inside the (Multi)Polygon, else 0."""
    from rasterio.features import rasterize as rio_rasterize
    from rasterio.transform import Affine

    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise RuntimeError(f"perimeter: expected a (Multi)Polygon, got {geometry.get('type')!r}")
    transform = Affine(grid.D_LON, 0.0, grid.LON_MIN, 0.0, -grid.D_LAT, grid.LAT_MAX)
    out = rio_rasterize(
        [(geometry, 1)], out_shape=(grid.ROWS, grid.COLS), transform=transform, fill=0, all_touched=False, dtype="uint8"
    )
    return out.ravel()


def bake() -> dict:
    spec = grid.EVENT.perimeter
    if not spec:
        raise RuntimeError(f"event {grid.EVENT.id} has no official perimeter")
    feats = _download(spec)["features"]
    if len(feats) != 1:
        raise RuntimeError(f"perimeter: expected 1 final perimeter for {spec['unique_fire_id']}, got {len(feats)}")
    props, geom = feats[0]["properties"], feats[0]["geometry"]
    inside = rasterize(geom)
    w, s, e, n = grid.bbox()
    edge = inside.reshape(grid.ROWS, grid.COLS)
    if edge[0].any() or edge[-1].any() or edge[:, 0].any() or edge[:, -1].any():
        raise RuntimeError("perimeter: the official perimeter touches the grid edge: enlarge the grid")
    inside.astype(np.uint8).tofile(grid.OUT_DIR / "perimeter.bin")
    km2 = grid.CELL_M * grid.CELL_M / 1e6
    return {
        "fire": f"{props['poly_IncidentName']} {props['attr_UniqueFireIdentifier']} ({props['poly_FeatureCategory']})",
        "official_km2": round(float(props["poly_GISAcres"]) * ACRE_M2 / 1e6, 2),
        "rasterised_km2": round(float(inside.sum()) * km2, 2),
        "cells": int(inside.sum()),
        "grid_bbox": [round(v, 4) for v in (w, s, e, n)],
    }
