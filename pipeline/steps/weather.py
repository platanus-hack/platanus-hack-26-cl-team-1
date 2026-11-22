"""weather.json: hourly ERA5-based reanalysis from the Open-Meteo historical archive at one point."""

from __future__ import annotations

import json

import requests

from . import grid

LAT, LON = -33.10, -71.49
URL = (
    "https://archive-api.open-meteo.com/v1/archive?latitude=-33.10&longitude=-71.49"
    "&start_date=2024-02-02&end_date=2024-02-03"
    "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
    "&timezone=America%2FSantiago"
)
SOURCE = (
    "Open-Meteo Historical Weather API (reanalysis based on ECMWF ERA5 / ERA5-Land), punto -33.10, -71.49, "
    "horario local America/Santiago. https://open-meteo.com/ (CC BY 4.0)"
)
FIELDS = {
    "tempC": "temperature_2m",
    "rh": "relative_humidity_2m",
    "windKmh": "wind_speed_10m",
    "windFromDeg": "wind_direction_10m",
    "gustKmh": "wind_gusts_10m",
}


def bake() -> dict:
    cache = grid.CACHE_DIR / "openmeteo_2024-02-02.json"
    if cache.exists():
        raw = json.loads(cache.read_text())
    else:
        r = requests.get(URL, timeout=60)
        r.raise_for_status()
        raw = r.json()
        cache.write_text(json.dumps(raw))
    h = raw["hourly"]
    units = raw["hourly_units"]
    if units["wind_speed_10m"] != "km/h" or units["temperature_2m"] != "°C":
        raise RuntimeError(f"unexpected Open-Meteo units: {units}")
    times = h["time"]
    out = {"source": SOURCE, "lat": raw["latitude"], "lon": raw["longitude"], "times": times}
    for key, field in FIELDS.items():
        vals = h[field]
        if len(vals) != len(times) or any(v is None for v in vals):
            raise RuntimeError(f"Open-Meteo field {field} has missing values")
        out[key] = vals
    (grid.OUT_DIR / "weather.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    afternoon = [i for i, t in enumerate(times) if "2024-02-02T12:00" <= t <= "2024-02-02T20:00"]
    return {
        "hours": len(times),
        "2024-02-02 12-20h": {
            "tempC": f"{min(out['tempC'][i] for i in afternoon)}..{max(out['tempC'][i] for i in afternoon)}",
            "rh": f"{min(out['rh'][i] for i in afternoon)}..{max(out['rh'][i] for i in afternoon)}",
            "windKmh": f"{min(out['windKmh'][i] for i in afternoon)}..{max(out['windKmh'][i] for i in afternoon)}",
            "gustKmh max": max(out["gustKmh"][i] for i in afternoon),
        },
    }
