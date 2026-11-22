"""Print the checks quoted in web/src/engine/population/MODEL.md: national totals, the work / home ratio (if
everyone were at work or school) in a few known places, and the simulation grid's totals. Reads only the
committed files in web/public/data/ (no network).

    cd pipeline && uv run python population_report.py
"""

from __future__ import annotations

import sys

import numpy as np

from steps import grid, population as pop

# (name, west, south, east, north): rough boxes, for a sanity check of the job proxy, not official limits.
PLACES = [
    ("Santiago, centro (~3 x 3 km)", -70.67, -33.46, -70.635, -33.43),
    ("Providencia / Las Condes, El Golf", -70.62, -33.43, -70.59, -33.41),
    ("Puente Alto", -70.62, -33.63, -70.54, -33.56),
    ("Gran Santiago (rectangle)", -70.85, -33.65, -70.45, -33.30),
    ("Vina del Mar, centro", -71.56, -33.03, -71.54, -33.01),
    ("Valparaiso, plan", -71.64, -33.05, -71.60, -33.03),
    ("Quilpue + Villa Alemana", -71.47, -33.08, -71.35, -33.03),
    ("Concepcion, centro", -73.07, -36.84, -73.04, -36.81),
    ("Arica", -70.35, -18.55, -70.25, -18.43),
]


def main() -> int:
    ng, meta, nat = pop.load_national()
    t = meta["totals"]
    print(f"national: {meta['n']:,} cells of 30\"; home {t['home']:,}, work {t['work']:,}, stay home {t['stayHome']:,}")
    r, c = nat["cell"] // ng.cols, nat["cell"] % ng.cols
    lat = ng.lat_n - (r + 0.5) * pop.NAT_DEG
    lon = ng.lon_w + (c + 0.5) * pop.NAT_DEG
    print(f"\n{'place':<36}{'home':>12}{'work':>12}{'work/home':>11}")
    for name, w, s, e, n in PLACES:
        m = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
        h, k = nat["home"][m].sum(), nat["work"][m].sum()
        print(f"{name:<36}{h:>12,.0f}{k:>12,.0f}{k / h:>11.2f}")
    home = np.fromfile(grid.OUT_DIR / "population_home.bin", dtype="<f4")
    work = np.fromfile(grid.OUT_DIR / "population_work.bin", dtype="<f4")
    print(f"\nsimulation grid: home {home.sum():,.0f}, work {work.sum():,.0f} (commuters across its edges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
