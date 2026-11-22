"""Bake every Cortafuego data file of one event (steps/events.py) into web/public/data/ (formats:
web/src/engine/types.ts).

    cd pipeline && uv run python bake.py                     # Viña del Mar 2024 -> web/public/data/
    cd pipeline && uv run python bake.py --event eaton-2025  # Eaton 2025 -> web/public/data/eaton-2025/
    cd pipeline && uv run python bake.py --refresh           # wipe the event's download cache first

Downloads are cached per event (.cache/ for Viña, .cache/<event>/ for the others), so reruns are offline.

Prints a summary at the end. Any failure raises: no partial silent output.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time

from steps import (
    buildings,
    dins,
    events,
    firms,
    fuel,
    goes,
    grid,
    ignitions,
    perimeter,
    population,
    roads,
    scar,
    terrain,
    weather,
    wui,
)


def sources(ev: events.Event) -> dict[str, str]:
    """grid.json "sources" of an event (dataset -> citation, shown on the "Fuentes" panel)."""
    out = dict(ev.sources)
    if ev.population:
        out["Población por hora"] = population.SOURCE
    return out


SOURCES = sources(events.EVENTS[events.DEFAULT])


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
    if meta["sources"] != sources(grid.EVENT):
        raise AssertionError("grid.json: sources differ from the event's")
    if grid.EVENT.population:
        for name in ("population_home.bin", "population_work.bin"):
            a = raw(name, "<f4", n)
            if not np.isfinite(a).all() or (a < 0).any():
                raise AssertionError(f"{name}: negative or non-finite values")
        population.load_national()  # raises on a missing or inconsistent national product
    if grid.EVENT.perimeter:
        if not np.isin(raw("perimeter.bin", "u1", n), [0, 1]).all():
            raise AssertionError("perimeter.bin: values outside {0, 1}")
    if grid.EVENT.dins:
        pts = json.loads((d / "dins.json").read_text())
        codes = set(dins.DAMAGE_CODE.values())
        if not pts or any(len(p) != 3 or p[2] not in codes for p in pts):
            raise AssertionError("dins.json: empty or malformed records")
        ll = np.array([p[:2] for p in pts])
        if (grid.cell_index(ll[:, 0], ll[:, 1]) < 0).any():
            raise AssertionError("dins.json: points outside the grid")


def step(name: str, fn, *args):
    t = time.time()
    print(f"[{name}] ...", flush=True)
    out = fn(*args)
    print(f"[{name}] done in {time.time() - t:.1f} s", flush=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--event", default=events.DEFAULT, choices=sorted(events.EVENTS), help="event to bake")
    ap.add_argument("--refresh", action="store_true", help="wipe the event's download cache and re-download")
    args = ap.parse_args()
    ev = grid.select(args.event)

    if args.refresh and grid.CACHE_DIR.exists():
        # Other events' caches live inside Viña's cache directory: keep them.
        keep = {grid.CACHE_ROOT / e.cache_subdir for e in events.EVENTS.values() if e.cache_subdir and e.id != ev.id}
        for p in grid.CACHE_DIR.iterdir():
            if p not in keep:
                shutil.rmtree(p) if p.is_dir() else p.unlink()
    grid.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    grid.OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print(f"event {ev.id}: {grid.ROWS} x {grid.COLS} cells -> {grid.OUT_DIR}", flush=True)

    meta = grid.grid_meta(sources(ev))
    (grid.OUT_DIR / "grid.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
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
    if ev.population:
        summary["population"] = step("population (from the committed national product)", population.bake_domain)
    _, summary["goes"] = step("goes", goes.bake)
    if ev.perimeter:
        summary["perimeter (validation only)"] = step("official perimeter", perimeter.bake)
    if ev.dins:
        summary["dins (validation only)"] = step("CAL FIRE damage inspection", dins.bake)

    step("validate outputs against types.ts", validate_outputs)

    print("\n=== Cortafuego data bake summary ===")
    print(
        f"grid: {grid.ROWS} x {grid.COLS} cells of {grid.CELL_M} m, "
        f"lat {grid.LAT_MIN:.4f}..{grid.LAT_MAX}, lon {grid.LON_MIN}..{grid.LON_MAX:.4f}, t0 {grid.T0}"
    )
    total = 0
    for name in ev.outputs:
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
