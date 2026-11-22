"""dins.json: CAL FIRE Damage Inspection (DINS) points of the event, VALIDATION ONLY (the browser app does not
load it). One record per inspected structure inside the grid: [lon, lat, damage code], damage codes below.

Source (grid.EVENT.dins): the public CAL FIRE DINS feature service of the fire (ArcGIS, no key), read as GeoJSON
in EPSG:4326 in pages of PAGE records, cached in the event's download cache. Field DAMAGE is a closed set
(the service's coded-value domain); any other value stops the bake.
"""

from __future__ import annotations

import json

import numpy as np
import requests

from . import grid

PAGE = 10_000  # under the service's maxRecordCount (16,000)
DAMAGE_CODE = {
    "No Damage": "none",
    "Affected (1-9%)": "affected",
    "Minor (10-25%)": "minor",
    "Major (26-50%)": "major",
    "Destroyed (>50%)": "destroyed",
    "Inaccessible": "inaccessible",
}


def _download(url: str) -> list[dict]:
    cache = grid.CACHE_DIR / "dins.geojson"
    if cache.exists():
        return json.loads(cache.read_text())["features"]
    feats: list[dict] = []
    while True:
        params = {
            "where": "1=1",
            "outFields": "OBJECTID,DAMAGE",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "OBJECTID",
            "resultOffset": str(len(feats)),
            "resultRecordCount": str(PAGE),
            "f": "geojson",
        }
        r = requests.get(url + "/query", params=params, timeout=180)
        r.raise_for_status()
        page = r.json()
        if "features" not in page:
            raise RuntimeError(f"dins: unexpected response from {url}: {str(page)[:300]}")
        feats += page["features"]
        if len(page["features"]) < PAGE:
            break
    r = requests.get(url + "/query", params={"where": "1=1", "returnCountOnly": "true", "f": "json"}, timeout=60)
    r.raise_for_status()
    if r.json().get("count") != len(feats):
        raise RuntimeError(f"dins: downloaded {len(feats)} points, the service counts {r.json().get('count')}")
    cache.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    return feats


def bake() -> dict:
    spec = grid.EVENT.dins
    if not spec:
        raise RuntimeError(f"event {grid.EVENT.id} has no DINS source")
    feats = _download(spec["url"])
    rows = []
    for f in feats:
        g, dmg = f.get("geometry"), f["properties"].get("DAMAGE")
        if dmg not in DAMAGE_CODE:
            raise RuntimeError(f"dins: unknown DAMAGE value {dmg!r} (OBJECTID {f['properties'].get('OBJECTID')})")
        if not g or g.get("type") != "Point":
            raise RuntimeError(f"dins: point without geometry (OBJECTID {f['properties'].get('OBJECTID')})")
        lon, lat = g["coordinates"][:2]
        rows.append((round(float(lon), 6), round(float(lat), 6), DAMAGE_CODE[dmg]))
    inside = grid.cell_index(np.array([r[0] for r in rows]), np.array([r[1] for r in rows])) >= 0
    kept = sorted(r for r, ok in zip(rows, inside) if ok)
    (grid.OUT_DIR / "dins.json").write_text(json.dumps([list(r) for r in kept], separators=(",", ":")))
    counts: dict[str, int] = {}
    for r in kept:
        counts[r[2]] = counts.get(r[2], 0) + 1
    return {"points": len(kept), "outside_grid": int((~inside).sum()), "by_damage": counts}
