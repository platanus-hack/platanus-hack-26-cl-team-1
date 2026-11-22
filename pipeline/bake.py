"""Bake every Cortafuego data file into web/public/data/ (formats: web/src/engine/types.ts).

    cd pipeline && uv run python bake.py            # uses .cache/ when present (idempotent)
    cd pipeline && uv run python bake.py --refresh  # wipes the download cache first and re-downloads

Prints a summary at the end. Any failure raises: no partial silent output.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time

from steps import buildings, firms, fuel, goes, grid, ignitions, roads, scar, terrain, weather, wui

SOURCES = {
    "Relieve": "Copernicus DEM GLO-30 (ESA / Airbus), tiles S33/S34 W072 vía AWS Open Data "
    "(https://registry.opendata.aws/copernicus-dem/). © DLR e.V. 2010-2014 y © Airbus Defence and Space "
    "GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y ESA.",
    "Cobertura de suelo / combustible": "ESA WorldCover 10 m 2021 v200 (https://esa-worldcover.org/), "
    "© ESA WorldCover project 2021 / Contiene datos Copernicus Sentinel modificados (2021), CC BY 4.0. "
    "Clase mayoritaria por celda de 60 m. Zonas urbanas divididas en interfaz (casas entre vegetación: "
    ">= 40 % de vegetación en 180 m, según WorldCover y NDVI de Sentinel-2 del 18-01-2024, previo al incendio) "
    "y ciudad consolidada (el resto).",
    "Edificaciones": f"Overture Maps Foundation, buildings, release {buildings.OVERTURE_RELEASE} "
    "(https://overturemaps.org/), ODbL 1.0 (incluye OpenStreetMap y huellas derivadas de Microsoft y "
    "Google). Huellas actuales, no necesariamente las de febrero de 2024.",
    "Calles": "© OpenStreetMap contributors, vía Overpass API (https://www.openstreetmap.org/copyright), "
    "ODbL 1.0. Red actual, no necesariamente la de febrero de 2024.",
    "Meteorología": weather.SOURCE,
    "Cicatriz del incendio": scar.SOURCE,
    "Detecciones satelitales de fuego": firms.SOURCE,
    "Detecciones de fuego GOES-16 (cada 10 min)": goes.SOURCE,
    "Focos predefinidos": "Ubicaciones aproximadas según primeras detecciones satelitales (NASA FIRMS VIIRS); "
    "hora del foco Las Tablas según reportes de prensa (CIPER, Cooperativa). No son datos oficiales.",
}

OUTPUTS = [
    "grid.json",
    "elevation.bin",
    "fuel.bin",
    "buildings.bin",
    "roads.json",
    "weather.json",
    "scar.bin",
    "firms.json",
    "goes.json",
    "ignitions.json",
]


def validate_outputs() -> None:
    """Re-read every output and check it against the contract in web/src/engine/types.ts."""
    import numpy as np

    d, n = grid.OUT_DIR, grid.N_CELLS

    def raw(name: str, dtype: str, count: int | None = None) -> "np.ndarray":
        a = np.fromfile(d / name, dtype=dtype)
        if count is not None and a.size != count:
            raise AssertionError(f"{name}: {a.size} values, expected {count}")
        return a

    meta = json.loads((d / "grid.json").read_text())
    for k in ("rows", "cols", "latMax", "lonMin", "dLat", "dLon", "cellM", "t0", "sources"):
        if k not in meta:
            raise AssertionError(f"grid.json: missing {k}")
    elev = raw("elevation.bin", "<f4", n)
    if not np.isfinite(elev).all():
        raise AssertionError("elevation.bin: non-finite values")
    if not np.isin(raw("fuel.bin", "u1", n), np.arange(7)).all():
        raise AssertionError("fuel.bin: values outside FUEL")
    if not np.isin(raw("scar.bin", "u1", n), [0, 1, 255]).all():
        raise AssertionError("scar.bin: values outside {0, 1, 255}")
    b = raw("buildings.bin", "<f4")
    if b.size % 3 or not np.isfinite(b).all() or (grid.cell_index(b[0::3], b[1::3]) < 0).any():
        raise AssertionError("buildings.bin: malformed or out-of-grid buildings")
    r = json.loads((d / "roads.json").read_text())
    nn = len(r["nodes"])
    ll = np.array(r["nodes"]).reshape(-1, 2)
    if (grid.cell_index(ll[:, 0], ll[:, 1]) < 0).any():
        raise AssertionError("roads.json: nodes outside the grid")
    if len(r["geoms"]) != len(r["edges"]):
        raise AssertionError("roads.json: geoms and edges differ in length")
    for u, v, length, cls in r["edges"]:
        if not (0 <= u < nn and 0 <= v < nn and length >= 0 and cls in range(6)):
            raise AssertionError(f"roads.json: bad edge {[u, v, length, cls]}")
    w = json.loads((d / "weather.json").read_text())
    for k in ("tempC", "rh", "windKmh", "windFromDeg", "gustKmh"):
        if len(w[k]) != len(w["times"]):
            raise AssertionError(f"weather.json: {k} length differs from times")
    for p in json.loads((d / "firms.json").read_text()):
        if set(p) != {"lon", "lat", "timeLocal", "satellite", "frp"}:
            raise AssertionError(f"firms.json: bad point {p}")
    for p in json.loads((d / "goes.json").read_text()):
        if set(p) != {"lon", "lat", "timeLocal", "satellite", "frp"} or p["frp"] < 0:
            raise AssertionError(f"goes.json: bad point {p}")
    for p in json.loads((d / "ignitions.json").read_text()):
        if set(p) != {"id", "label", "lon", "lat", "timeLocal", "source"}:
            raise AssertionError(f"ignitions.json: bad preset {p}")


def step(name: str, fn, *args):
    t = time.time()
    print(f"[{name}] ...", flush=True)
    out = fn(*args)
    print(f"[{name}] done in {time.time() - t:.1f} s", flush=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="wipe the download cache and re-download everything")
    args = ap.parse_args()

    if args.refresh and grid.CACHE_DIR.exists():
        shutil.rmtree(grid.CACHE_DIR)
    grid.CACHE_DIR.mkdir(exist_ok=True)
    grid.OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    (grid.OUT_DIR / "grid.json").write_text(json.dumps(grid.grid_meta(SOURCES), indent=1, ensure_ascii=False))
    summary: dict[str, object] = {}
    summary["elevation"] = step("elevation", terrain.bake)
    bld, bld_src = step("buildings", buildings.load)
    buildings.write(bld)
    summary["buildings"] = {
        "source": bld_src,
        "count": len(bld),
        "footprint_km2": round(float(bld[:, 2].sum()) / 1e6, 1),
    }
    wc_counts = step("worldcover class counts", fuel.class_counts)
    roof_codes, summary["fuel, roof-coverage split (base)"] = step(
        "fuel base", fuel.bake, wc_counts, buildings.coverage(bld)
    )
    fuel_codes, summary["fuel.bin, WUI split"] = step("fuel (WUI split)", wui.bake, wc_counts, bld, roof_codes)
    summary["roads"] = step("roads", roads.bake)
    summary["weather"] = step("weather", weather.bake)
    firms_pts, summary["firms"] = step("firms", firms.bake)
    summary["scar"] = step("scar", scar.bake, firms_pts, fuel_codes)
    summary["ignitions"] = step("ignitions", ignitions.bake, firms_pts)
    _, summary["goes"] = step("goes", goes.bake)

    step("validate outputs against types.ts", validate_outputs)

    print("\n=== Cortafuego data bake summary ===")
    print(
        f"grid: {grid.ROWS} x {grid.COLS} cells of {grid.CELL_M} m, "
        f"lat {grid.LAT_MIN:.4f}..{grid.LAT_MAX}, lon {grid.LON_MIN}..{grid.LON_MAX:.4f}, t0 {grid.T0}"
    )
    total = 0
    for name in OUTPUTS:
        size = (grid.OUT_DIR / name).stat().st_size
        total += size
        print(f"  {name:<15} {size / 1e6:8.2f} MB")
    print(f"  {'TOTAL':<15} {total / 1e6:8.2f} MB")
    for k, v in summary.items():
        print(f"{k}: {json.dumps(v, ensure_ascii=False, indent=1) if isinstance(v, (dict, list)) else v}")
    print(f"total time {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
