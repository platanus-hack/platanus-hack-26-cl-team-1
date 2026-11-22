"""ignitions.json: preset ignition points for 2 Feb 2024.

Documented facts (press, Feb 2024 onwards) are thin on exact points, so the LOCATIONS come from the first
satellite detections (FIRMS VIIRS pass at 14:47 local), and each preset says so:
  * Las Tablas / Lago Peñuelas: press reports the fire was detected by a CONAF lookout tower at about
    12:06 and that it started around noon at Fundo Las Tablas, next to the Lago Peñuelas reserve (Ruta 68
    closed at km 91). The exact point is not public: we use the upwind (southern, the wind blew from
    S-SSW) end of the first VIIRS cluster, and 12:05 as start time.
  * Quilpué / Villa Alemana (east): a second, separate cluster in the first VIIRS pass, at the place of the
    Lo Moscoso fire, which Spanish Wikipedia and La Tercera report as declared at 13:46. Location = centroid
    of that cluster in the first pass, start = 30 min before its first detection (14:17); moving it to 13:46
    fitted worse in calibration, so the satellite-based estimate stays.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage

from . import grid

FIRST_PASS = "2024-02-02T14:47"
CLUSTER_LINK_M = 1500  # single-linkage distance that separates the simultaneous fires
LEAD_MIN = 30  # assumed start this many minutes before the first detection when no time is documented
UPWIND_BAND_M = 1000  # detections within this distance of the cluster's southern edge give the origin

LAS_TABLAS_TIME = "2024-02-02T12:05"
LAS_TABLAS_SOURCE = (
    "Hora: detección ~12:06 por torre de CONAF reportada por prensa (CIPER; Cooperativa 2024-02-02: "
    "inicio cerca del mediodía en Fundo Las Tablas, junto a la Reserva Nacional Lago Peñuelas). Ubicación "
    "aprox., según primeras detecciones satelitales (extremo sur del primer cúmulo NASA FIRMS VIIRS, 14:47)."
)
EAST_SOURCE = (
    "Aprox., según primeras detecciones satelitales: centroide del cúmulo NASA FIRMS VIIRS de las 14:47 y "
    "hora estimada 30 min antes. Coincide con el incendio de Lo Moscoso, que se declaró a las 13:46 según "
    "Wikipedia en español (https://es.wikipedia.org/wiki/Gran_incendio_de_Valpara%C3%ADso_de_2024) y "
    "La Tercera."
)


def _clusters(pts: list[dict]) -> list[list[dict]]:
    x = np.array([[p["lon"] * 111320 * np.cos(np.radians(p["lat"])), p["lat"] * 111320] for p in pts])
    labels = fcluster(linkage(x, "single"), CLUSTER_LINK_M, "distance")
    return [[pts[i] for i in np.flatnonzero(labels == lab)] for lab in np.unique(labels)]


def bake(firms_points: list[dict]) -> list[dict]:
    first = [p for p in firms_points if p["timeLocal"] == FIRST_PASS and p["satellite"].startswith("VIIRS")]
    if not first:
        raise RuntimeError(f"no VIIRS detections at {FIRST_PASS}: cannot place the ignition presets")
    clusters = sorted(_clusters(first), key=lambda c: np.mean([p["lon"] for p in c]))
    if len(clusters) != 2:
        raise RuntimeError(f"expected 2 fire clusters in the first VIIRS pass, found {len(clusters)}: review")
    west, east = clusters

    south = min(p["lat"] for p in west)
    band = [p for p in west if (p["lat"] - south) * 111320 <= UPWIND_BAND_M]
    t_east = datetime.strptime(FIRST_PASS, "%Y-%m-%dT%H:%M") - timedelta(minutes=LEAD_MIN)
    presets = [
        {
            "id": "las-tablas-penuelas",
            "label": "Las Tablas / Lago Peñuelas (aprox.)",
            "lon": round(float(np.mean([p["lon"] for p in band])), 5),
            "lat": round(float(np.mean([p["lat"] for p in band])), 5),
            "timeLocal": LAS_TABLAS_TIME,
            "source": LAS_TABLAS_SOURCE,
        },
        {
            "id": "quilpue-villa-alemana-oriente",
            "label": "Foco Quilpué / Villa Alemana (aprox., según primeras detecciones satelitales)",
            "lon": round(float(np.mean([p["lon"] for p in east])), 5),
            "lat": round(float(np.mean([p["lat"] for p in east])), 5),
            "timeLocal": t_east.strftime("%Y-%m-%dT%H:%M"),
            "source": EAST_SOURCE,
        },
    ]
    for p in presets:
        if grid.cell_index(p["lon"], p["lat"]) < 0:
            raise RuntimeError(f"ignition preset {p['id']} falls outside the grid")
    (grid.OUT_DIR / "ignitions.json").write_text(json.dumps(presets, indent=1, ensure_ascii=False))
    return presets
