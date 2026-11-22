"""firms.json: NASA FIRMS active-fire detections (VIIRS S-NPP, VIIRS NOAA-20, MODIS) in the grid, local
dates 2-4 Feb 2024. Read from the FIRMS yearly country CSVs (Chile 2024, public, no key), downloaded once
into .cache/firms/."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta

import requests

from . import grid

COUNTRY_CSV = "https://firms.modaps.eosdis.nasa.gov/data/country/{p}/2024/{p}_2024_Chile.csv"
FILES = {"snpp.csv": "viirs-snpp", "n20.csv": "viirs-jpss1", "modis.csv": "modis"}
SATELLITE = {
    "N": "VIIRS S-NPP",
    "N20": "VIIRS NOAA-20",
    "N21": "VIIRS NOAA-21",
    "Terra": "MODIS Terra",
    "Aqua": "MODIS Aqua",
}
UTC_OFFSET_H = -3  # Chile summer time (CLST) in February 2024
FIRST_DAY, LAST_DAY = "2024-02-02", "2024-02-04"
SOURCE = (
    "NASA FIRMS (Fire Information for Resource Management System), detecciones VIIRS S-NPP / NOAA-20 375 m "
    "y MODIS 1 km, archivo por país (Chile 2024). https://firms.modaps.eosdis.nasa.gov/ "
    "(datos NASA, uso libre con atribución)"
)


def load() -> list[dict]:
    pts = []
    for name in FILES:
        path = grid.CACHE_DIR / "firms" / name
        if not path.exists():
            url = COUNTRY_CSV.format(p=FILES[name])
            r = requests.get(url, timeout=300)
            r.raise_for_status()
            if not r.text.startswith("latitude,longitude"):
                raise RuntimeError(f"{url}: not a FIRMS CSV (starts with {r.text[:80]!r})")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(r.text)
        with path.open() as f:
            for row in csv.DictReader(f):
                lat, lon = float(row["latitude"]), float(row["longitude"])
                if grid.cell_index(lon, lat) < 0:
                    continue
                utc = datetime.strptime(row["acq_date"] + row["acq_time"].zfill(4), "%Y-%m-%d%H%M")
                local = utc + timedelta(hours=UTC_OFFSET_H)
                day = local.strftime("%Y-%m-%d")
                if not (FIRST_DAY <= day <= LAST_DAY):
                    continue
                sat = row["satellite"]
                if sat not in SATELLITE:
                    raise RuntimeError(f"{name}: unknown satellite code {sat!r}")
                pts.append(
                    {
                        "lon": round(lon, 5),
                        "lat": round(lat, 5),
                        "timeLocal": local.strftime("%Y-%m-%dT%H:%M"),
                        "satellite": SATELLITE[sat],
                        "frp": float(row["frp"]),
                    }
                )
    pts.sort(key=lambda p: (p["timeLocal"], p["satellite"], p["lat"], p["lon"]))
    if not pts:
        raise RuntimeError("no FIRMS detections in the grid for 2-4 Feb 2024")
    return pts


def bake() -> tuple[list[dict], dict]:
    pts = load()
    (grid.OUT_DIR / "firms.json").write_text(json.dumps(pts, separators=(",", ":")))
    passes: dict[str, int] = {}
    for p in pts:
        key = f"{p['timeLocal']} {p['satellite']}"
        passes[key] = passes.get(key, 0) + 1
    return pts, {"detections": len(pts), "passes": passes}
