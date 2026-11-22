"""weather.json: hourly ERA5-based reanalysis from the Open-Meteo historical archive at one point (per event:
grid.EVENT.weather_*), in the event's local time."""

from __future__ import annotations

import json

import requests

from . import grid

URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
SOURCE_KEY = "Meteorología"  # the citation is defined once, in the event's sources (steps/events.py)
FIELDS = {
    "tempC": "temperature_2m",
    "rh": "relative_humidity_2m",
    "windKmh": "wind_speed_10m",
    "windFromDeg": "wind_direction_10m",
    "gustKmh": "wind_gusts_10m",
}


def bake() -> dict:
    ev = grid.EVENT
    source = ev.sources[SOURCE_KEY]
    cache = grid.CACHE_DIR / f"openmeteo_{ev.weather_first_day}.json"
    if cache.exists():
        raw = json.loads(cache.read_text())
    else:
        params = {
            "latitude": f"{ev.weather_lat:.2f}",
            "longitude": f"{ev.weather_lon:.2f}",
            "start_date": ev.weather_first_day,
            "end_date": ev.weather_last_day,
            "hourly": HOURLY,
            "timezone": ev.timezone,
        }
        r = requests.get(URL, params=params, timeout=60)
        r.raise_for_status()
        raw = r.json()
        cache.write_text(json.dumps(raw))
    h = raw["hourly"]
    units = raw["hourly_units"]
    if units["wind_speed_10m"] != "km/h" or units["temperature_2m"] != "°C":
        raise RuntimeError(f"unexpected Open-Meteo units: {units}")
    times = h["time"]
    out = {"source": source, "lat": raw["latitude"], "lon": raw["longitude"], "times": times}
    for key, field in FIELDS.items():
        vals = h[field]
        if len(vals) != len(times) or any(v is None for v in vals):
            raise RuntimeError(f"Open-Meteo field {field} has missing values")
        out[key] = vals
    (grid.OUT_DIR / "weather.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    if raw.get("timezone") != ev.timezone:
        raise RuntimeError(f"Open-Meteo answered in time zone {raw.get('timezone')!r}, expected {ev.timezone}")
    lo, hi = ev.weather_summary
    afternoon = [i for i, t in enumerate(times) if lo <= t <= hi]
    if not afternoon:
        raise RuntimeError(f"weather: no hours in the summary window {lo}..{hi}")
    return {
        "hours": len(times),
        f"{lo}..{hi}": {
            "tempC": f"{min(out['tempC'][i] for i in afternoon)}..{max(out['tempC'][i] for i in afternoon)}",
            "rh": f"{min(out['rh'][i] for i in afternoon)}..{max(out['rh'][i] for i in afternoon)}",
            "windKmh": f"{min(out['windKmh'][i] for i in afternoon)}..{max(out['windKmh'][i] for i in afternoon)}",
            "gustKmh max": max(out["gustKmh"][i] for i in afternoon),
        },
    }
