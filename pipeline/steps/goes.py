"""goes.json: GOES-16 ABI fire pixels (L2 Fire Detection and Characterization, full disk, every 10 min) whose
centre falls in the grid, from 2 Feb 2024 12:00 to 3 Feb 04:00 local. Same record shape as firms.json. Used only
to score the pace of the simulated fire (web/src/engine/fire/calibrate.ts); the browser app does not load it.

Files come from the public NOAA bucket on AWS (no key) and are cached in .cache/goes/. Pixel centres are
converted from the ABI fixed grid (scan angles in radians) to geodetic lon / lat with the GOES-R PUG formulas.
The full-disk pixel is ~2 km at nadir and ~2.5-3 km over central Chile, so one detection says "fire somewhere
in this ~2.5 km pixel"."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

import numpy as np
import rasterio
import requests

from . import grid

BUCKET = "https://noaa-goes16.s3.amazonaws.com"
PRODUCT = "ABI-L2-FDCF"
SATELLITE = "GOES-16 ABI"
UTC_OFFSET_H = -3  # Chile summer time (CLST) in February 2024
FIRST_UTC = datetime(2024, 2, 2, 15)  # 2 Feb 12:00 local
LAST_UTC = datetime(2024, 2, 3, 6)  # 3 Feb 03:00-04:00 local (last hour included)
FILES_PER_HOUR = 6  # mode 6 full disk: one scan every 10 min
MID_SCAN_MIN = 5  # a full-disk scan takes 10 min; the time recorded is the middle of it
# Fire categories of the Mask variable: good, saturated, cloud-contaminated, high and medium probability, plain
# and temporally filtered. Low probability (15, 35) is left out: it is where most false alarms are.
FIRE_MASK_CODES = frozenset({10, 11, 12, 13, 14, 30, 31, 32, 33, 34})
SOURCE = (
    "NOAA GOES-16 ABI L2 Fire Detection and Characterization (ABI-L2-FDCF), disco completo cada 10 min, "
    "píxel ~2 km, vía NOAA Open Data Dissemination en AWS (https://registry.opendata.aws/noaa-goes/). "
    "Datos públicos de NOAA. Solo se usa para medir el ritmo del fuego simulado."
)


def fixed_grid_to_lonlat(
    x_rad: np.ndarray, y_rad: np.ndarray, lon0_deg: float, h_m: float, r_eq: float, r_pol: float
) -> tuple[np.ndarray, np.ndarray]:
    """ABI fixed-grid scan angles (radians) to geodetic lon, lat (degrees). GOES-R PUG vol. 3, 5.1.2.8.1.
    h_m is the perspective point height above the ellipsoid; points off the Earth come out NaN."""
    big_h = h_m + r_eq
    sx, cx = np.sin(x_rad), np.cos(x_rad)
    sy, cy = np.sin(y_rad), np.cos(y_rad)
    a = sx**2 + cx**2 * (cy**2 + (r_eq**2 / r_pol**2) * sy**2)
    b = -2.0 * big_h * cx * cy
    c = big_h**2 - r_eq**2
    disc = b**2 - 4.0 * a * c
    with np.errstate(invalid="ignore"):
        r_s = (-b - np.sqrt(disc)) / (2.0 * a)
    s_x = r_s * cx * cy
    s_y = -r_s * sx
    s_z = r_s * cx * sy
    lat = np.degrees(np.arctan((r_eq**2 / r_pol**2) * s_z / np.sqrt((big_h - s_x) ** 2 + s_y**2)))
    lon = lon0_deg - np.degrees(np.arctan(s_y / (big_h - s_x)))
    return lon, lat


_START = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_")


def scan_time_local(name: str) -> str:
    """Local time (YYYY-MM-DDTHH:MM) of the middle of the scan, from the `s<yyyyjjjhhmmss><tenth>` field."""
    m = _START.search(name)
    if not m:
        raise RuntimeError(f"goes: no scan start time in file name {name!r}")
    year, doy, hh, mm, ss = (int(g) for g in m.groups())
    utc = datetime(year, 1, 1) + timedelta(days=doy - 1, hours=hh, minutes=mm, seconds=ss)
    local = utc + timedelta(hours=UTC_OFFSET_H, minutes=MID_SCAN_MIN)
    return local.strftime("%Y-%m-%dT%H:%M")


def _hour_keys(t: datetime) -> list[str]:
    prefix = f"{PRODUCT}/{t.year}/{t.timetuple().tm_yday:03d}/{t.hour:02d}/"
    r = requests.get(BUCKET, params={"list-type": "2", "prefix": prefix}, timeout=120)
    r.raise_for_status()
    keys = re.findall(r"<Key>([^<]+\.nc)</Key>", r.text)
    if len(keys) < FILES_PER_HOUR:
        raise RuntimeError(f"goes: {prefix} has {len(keys)} files, expected {FILES_PER_HOUR} (missing scans)")
    return sorted(keys)


def _files() -> list:
    """Every full-disk file of the window, downloaded once into .cache/goes/."""
    cache = grid.CACHE_DIR / "goes"
    cache.mkdir(parents=True, exist_ok=True)
    listing = cache / "keys.json"
    if listing.exists():
        keys = json.loads(listing.read_text())
    else:
        keys, t = [], FIRST_UTC
        while t <= LAST_UTC:
            keys += _hour_keys(t)
            t += timedelta(hours=1)
        listing.write_text(json.dumps(keys))
    paths = []
    for k in keys:
        path = cache / k.rsplit("/", 1)[1]
        if not path.exists():
            r = requests.get(f"{BUCKET}/{k}", timeout=300)
            r.raise_for_status()
            path.write_bytes(r.content)
        paths.append(path)
    return paths


def _projection(tags: dict) -> tuple[float, float, float, float]:
    try:
        return (
            float(tags["goes_imager_projection#longitude_of_projection_origin"]),
            float(tags["goes_imager_projection#perspective_point_height"]),
            float(tags["goes_imager_projection#semi_major_axis"]),
            float(tags["goes_imager_projection#semi_minor_axis"]),
        )
    except KeyError as e:
        raise RuntimeError(f"goes: projection attribute {e} missing") from e


def pixels(path) -> list[dict]:
    """Fire pixels of one full-disk file whose centre is in the grid."""
    with rasterio.open(f"netcdf:{path}:Mask") as src:
        lon0, h, r_eq, r_pol = _projection(src.tags())
        tf = src.transform
        mask = src.read(1)
    with rasterio.open(f"netcdf:{path}:Power") as src:
        power = src.read(1)
    rows, cols = np.nonzero(np.isin(mask, list(FIRE_MASK_CODES)))
    if rows.size == 0:
        return []
    x_m = tf.c + (cols + 0.5) * tf.a
    y_m = tf.f + (rows + 0.5) * tf.e
    lon, lat = fixed_grid_to_lonlat(x_m / h, y_m / h, lon0, h, r_eq, r_pol)
    t = scan_time_local(path.name)
    out = []
    for i in range(rows.size):
        if not np.isfinite(lon[i]) or grid.cell_index(float(lon[i]), float(lat[i])) < 0:
            continue
        frp = float(power[rows[i], cols[i]])
        if frp < 0:  # _FillValue -9: the algorithm found the fire but could not compute its power
            frp = 0.0  # recorded as 0 MW (README); the pacing score uses the location only
        out.append(
            {
                "lon": round(float(lon[i]), 5),
                "lat": round(float(lat[i]), 5),
                "timeLocal": t,
                "satellite": SATELLITE,
                "frp": round(frp, 2),
            }
        )
    return out


def bake() -> tuple[list[dict], dict]:
    pts: list[dict] = []
    for path in _files():
        pts += pixels(path)
    pts.sort(key=lambda p: (p["timeLocal"], p["lat"], p["lon"]))
    if not pts:
        raise RuntimeError("goes: no GOES-16 fire pixels in the grid for 2-3 Feb 2024")
    (grid.OUT_DIR / "goes.json").write_text(json.dumps(pts, separators=(",", ":")))
    per_hour: dict[str, int] = {}
    for p in pts:
        per_hour[p["timeLocal"][:13]] = per_hour.get(p["timeLocal"][:13], 0) + 1
    return pts, {"pixels": len(pts), "no_frp": sum(p["frp"] == 0 for p in pts), "per_hour": per_hour}
