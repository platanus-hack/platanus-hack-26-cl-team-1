"""Tiny cached Overpass API client."""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
ROUNDS = 3  # passes over all endpoints; the public servers answer 502/504 when at capacity
BACKOFF_S = [10, 30, 60]
HEADERS = {"User-Agent": "cortafuego-pipeline/0.1 (hackathon data bake)"}


def query(q: str, cache: Path) -> dict:
    """Run an Overpass QL query, caching the raw JSON response in `cache`."""
    if cache.exists():
        return json.loads(cache.read_text())
    errors = []
    for rnd in range(ROUNDS):
        for url in ENDPOINTS:
            try:
                t = time.time()
                r = requests.post(url, data={"data": q}, headers=HEADERS, timeout=600)
                r.raise_for_status()
                data = r.json()
                if "elements" not in data:
                    raise RuntimeError(f"unexpected Overpass response keys: {list(data)}")
                if data.get("remark"):
                    # Overpass reports timeouts / memory errors here with a partial result.
                    raise RuntimeError(f"Overpass remark: {data['remark']}")
                cache.write_text(json.dumps(data))
                print(f"  overpass {url.split('/')[2]}: {len(data['elements'])} elements in {time.time() - t:.0f} s")
                return data
            except Exception as exc:  # noqa: BLE001 - collected and raised below
                errors.append(f"{url} round {rnd + 1}: {type(exc).__name__}: {exc}")
                print(f"  overpass {url.split('/')[2]} failed ({type(exc).__name__}), trying the next one")
        time.sleep(BACKOFF_S[rnd])
    raise RuntimeError("all Overpass endpoints failed:\n" + "\n".join(errors))
