"""Where people are: residents (night, weekends) and where those same residents are during weekday working and
school hours, for all of Chile and refined onto the simulation grid.

Two layers, same people, same total for the country:

- home: residents per cell (WorldPop 2024, constrained, 3 arc-seconds ~ 100 m).
- work: where each resident would be if they were at their workplace or school. Each cell's residents are sent
  to non-residential building volume (GHSL GHS-BUILT-V NRES 2025, 3") with an origin-constrained gravity
  model: from home cell i to destination j with probability NRES_j K(d_ij) / sum_k NRES_k K(d_ik),
  K(d) = exp(-d / COMMUTE_SCALE_M) for d <= COMMUTE_MAX_M, else 0. Residents with no non-residential building
  within COMMUTE_MAX_M (remote rural areas) work where they live: their work location is their home.

Which share of residents is out at a given time (weekday hours, weekends, school term) is not baked: it is the
time-of-day model in web/src/engine/population/index.ts, applied in the browser to these two layers.

National product (committed, ~1 km): web/public/data/national/population_cl.{json,bin}, on a 30" grid aligned
with WorldPop's (10 x 10 WorldPop pixels per cell). Sparse: only cells with residents, workers or
non-residential volume. The gravity model runs on that grid.

Domain product (the 60 m simulation grid): population_home.bin and population_work.bin, Float32 per cell. Each
national cell's home is split over its WorldPop pixels as WorldPop has it; its work over its GHSL pixels in
proportion to non-residential volume (or over its WorldPop pixels for the stay-at-home cells). The 3" pixels
are then split into SUPERSAMPLE x SUPERSAMPLE sub-pixels, each binned into the 60 m cell holding its centre:
mass-conserving, so the domain totals equal the sum of the parts of the national cells inside it.
"""

from __future__ import annotations

import json
import math
import zipfile
from pathlib import Path

import numpy as np
import requests

from . import grid

# ---------------------------------------------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------------------------------------------

WORLDPOP_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2024/CHL/v1/100m/constrained/"
    "chl_pop_2024_CN_100m_R2025A_v1.tif"
)
# Non-residential building VOLUME (m3 per 3" pixel), not surface: volume counts floors, so an office tower weighs
# more than a warehouse of the same footprint. With surface (GHS-BUILT-S NRES) Santiago's centre came out with
# fewer people by day than by night (0.42) and Puente Alto's industrial belt as a job centre.
GHSL_COLLECTION = "GHS_BUILT_V_GLOBE_R2023A"
GHSL_PRODUCT = "GHS_BUILT_V_NRES_E2025_GLOBE_R2023A_4326_3ss"
GHSL_TILE_URL = (
    f"https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/{GHSL_COLLECTION}/{GHSL_PRODUCT}/V1-0/tiles/"
    f"{GHSL_PRODUCT}_V1_0_{{t}}.zip"
)
# GHSL 4326 tiles are 10 x 10 degrees (bounds verified by reading them): R11..R15 = lat -10.9..-60.9,
# C11 = lon -80..-70, C12 = lon -70..-60. Plus R12_C8 (Rapa Nui) and R12_C10 (San Felix / San Ambrosio).
GHSL_TILES = [f"R{r}_C{c}" for r in range(11, 16) for c in (11, 12)] + ["R12_C8", "R12_C10"]
# Neighbouring countries (geoBoundaries gbOpen ADM0, simplified): their non-residential buildings must not attract
# Chilean residents near the border (e.g. Tacna from Arica). Masking the neighbours, not Chile itself, because a
# coarse coastline would drop coastal cities (a 1:10M Chile outline misses ~144k residents of Punta Arenas and
# Chiloe); there are no non-residential buildings at sea for an imprecise coastline to let in.
NEIGHBOURS = ["ARG", "BOL", "PER"]
NEIGHBOUR_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/{c}/ADM0/geoBoundaries-{c}-ADM0_simplified.geojson"
)

CACHE = grid.CACHE_DIR / "population"
NATIONAL_DIR = grid.OUT_DIR / "national"
NATIONAL_JSON = NATIONAL_DIR / "population_cl.json"
NATIONAL_BIN = NATIONAL_DIR / "population_cl.bin"

SOURCE = (
    "Residentes: WorldPop 2024, población restringida a asentamientos, 100 m (R2025A v1; "
    "https://www.worldpop.org/, CC BY 4.0). Lugar de trabajo o estudio: volumen construido no residencial "
    "GHSL GHS-BUILT-V NRES 2025 (Comisión Europea, JRC; https://human-settlement.emergency.copernicus.eu/, "
    "CC BY 4.0) con un modelo de gravedad (escala 10 km, máximo 30 km); se excluye la de Argentina, Bolivia y Perú "
    "(límites de geoBoundaries). Cuántos están fuera de casa según día y hora: supuestos documentados "
    "(ENE del INE oct-dic 2024; Censo 2024; matrícula Mineduc). Es una estimación, no un conteo."
)

# ---------------------------------------------------------------------------------------------------------------
# Model constants (assumptions, documented in pipeline/README.md and web/src/engine/population/MODEL.md)
# ---------------------------------------------------------------------------------------------------------------

# Commuting distance scale and cut-off of the gravity kernel. A modelling assumption, not a measured value:
# most work and school trips in Chilean cities are under ~10-15 km; 30 km keeps Valparaiso-Vina-Quilpue-Villa
# Alemana one labour market and Santiago one, but does not send Rancagua's residents to Santiago.
COMMUTE_SCALE_M = 10_000.0
COMMUTE_MAX_M = 30_000.0

M_PER_DEG = 111_320.0  # same constant as grid.py
PX_DEG = 1 / 1200  # 3 arc-seconds (WorldPop and GHSL)
BLOCK = 10  # WorldPop pixels per national cell side: 30 arc-seconds
NAT_DEG = PX_DEG * BLOCK
SUPERSAMPLE = 6  # sub-pixels per 3" pixel side when binning onto the 60 m grid (~15 m x 13 m sub-pixels)
BAND_ROWS = 200  # national rows per gravity band (~1.7 degrees of latitude)
FFT_EPS = 1e-6  # FFT round-off below this (persons) is zeroed; real values are >= ~1e-3 persons


# ---------------------------------------------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------------------------------------------


def _download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest


def worldpop_path() -> Path:
    return _download(WORLDPOP_URL, CACHE / WORLDPOP_URL.rsplit("/", 1)[1])


def ghsl_paths() -> list[Path]:
    out = []
    for t in GHSL_TILES:
        z = _download(GHSL_TILE_URL.format(t=t), CACHE / f"{GHSL_PRODUCT}_{t}.zip")
        tif = CACHE / f"{GHSL_PRODUCT}_V1_0_{t}.tif"
        if not tif.exists():
            with zipfile.ZipFile(z) as zf:
                zf.extract(tif.name, CACHE)
        out.append(tif)
    return out


def neighbour_paths() -> list[Path]:
    return [_download(NEIGHBOUR_URL.format(c=c), CACHE / f"{c.lower()}_adm0.geojson") for c in NEIGHBOURS]


# ---------------------------------------------------------------------------------------------------------------
# Pure logic (unit-tested in tests/test_population.py)
# ---------------------------------------------------------------------------------------------------------------


def block_sum(a: np.ndarray, k: int) -> np.ndarray:
    """Sum of k x k blocks; the array is zero-padded at the bottom and right to a multiple of k."""
    r, c = a.shape
    rr, cc = -(-r // k) * k, -(-c // k) * k
    p = np.zeros((rr, cc), dtype=np.float64)
    p[:r, :c] = a
    return p.reshape(rr // k, k, cc // k, k).sum(axis=(1, 3))


def kernel(dy_m: float, dx_m: float, scale_m: float, max_m: float) -> np.ndarray:
    """exp(-d / scale) on a (2 hy + 1, 2 hx + 1) stencil of cells dy_m x dx_m, 0 beyond max_m. Centre = 1."""
    hy, hx = math.ceil(max_m / dy_m), math.ceil(max_m / dx_m)
    y = np.arange(-hy, hy + 1)[:, None] * dy_m
    x = np.arange(-hx, hx + 1)[None, :] * dx_m
    d = np.hypot(y, x)
    return np.where(d <= max_m, np.exp(-d / scale_m), 0.0)


def _conv(a: np.ndarray, k: np.ndarray) -> np.ndarray:
    from scipy.signal import fftconvolve

    out = fftconvolve(a, k, mode="same")
    out[np.abs(out) < FFT_EPS] = 0.0
    return out


def gravity(
    home: np.ndarray,
    attract: np.ndarray,
    lat_of_row: np.ndarray,
    cell_deg: float,
    scale_m: float = COMMUTE_SCALE_M,
    max_m: float = COMMUTE_MAX_M,
    band_rows: int = BAND_ROWS,
) -> tuple[np.ndarray, np.ndarray]:
    """Origin-constrained gravity on a lat/lon grid (row 0 north). Returns (work, stay):
    work[j] = sum_i home[i] attract[j] K(d_ij) / A_i with A_i = sum_k attract[k] K(d_ik), plus stay[j];
    stay = home where A == 0 (nobody to go to within max_m: they stay put). sum(work) == sum(home).

    Processed in latitude bands, each with its own kernel (cell width shrinks with cos(lat)). Every origin uses
    its band's kernel both for A_i and for spreading its residents, so mass is conserved exactly (up to FFT
    round-off) even across band edges."""
    rows, _ = home.shape
    dy = cell_deg * M_PER_DEG
    halo = math.ceil(max_m / dy)
    work = np.zeros(home.shape, dtype=np.float64)
    stay = np.zeros(home.shape, dtype=np.float64)
    for b0 in range(0, rows, band_rows):
        b1 = min(rows, b0 + band_rows)
        if not home[b0:b1].any():
            continue
        lat = float(np.mean(lat_of_row[b0:b1]))
        k = kernel(dy, dy * math.cos(math.radians(lat)), scale_m, max_m)
        w0, w1 = max(0, b0 - halo), min(rows, b1 + halo)
        cols = np.flatnonzero(home[b0:b1].any(axis=0) | attract[w0:w1].any(axis=0))
        hx = k.shape[1] // 2
        c0, c1 = max(0, int(cols.min()) - hx), min(home.shape[1], int(cols.max()) + hx + 1)
        att = attract[w0:w1, c0:c1].astype(np.float64)
        a = _conv(att, k)[b0 - w0 : b1 - w0]
        h = home[b0:b1, c0:c1].astype(np.float64)
        reach = a > 0
        ratio = np.zeros_like(h)
        ratio[reach] = h[reach] / a[reach]
        stay[b0:b1, c0:c1] += np.where(reach, 0.0, h)
        src = np.zeros_like(att)
        src[b0 - w0 : b1 - w0] = ratio
        work[w0:w1, c0:c1] += att * _conv(src, k)
    return work + stay, stay


def supersample_bin(
    values: np.ndarray, lon_w: float, lat_n: float, px_deg: float, s: int, cell_index
) -> np.ndarray:
    """Split each pixel of `values` (row 0 north; pixel (r, c) spans lon_w + c px .. +1, lat_n - r px .. -1) into
    s x s sub-pixels of value / s^2 and sum them into the simulation grid cell holding each sub-pixel centre
    (cell_index(lon, lat) -> flat index, -1 outside). Returns Float64 (N_CELLS,)."""
    r, c = np.nonzero(values)
    v = values[r, c].astype(np.float64) / (s * s)
    off = (np.arange(s) + 0.5) / s
    out = np.zeros(grid.N_CELLS, dtype=np.float64)
    for oy in off:
        lat = lat_n - (r + oy) * px_deg
        for ox in off:
            lon = lon_w + (c + ox) * px_deg
            idx = cell_index(lon, lat)
            keep = idx >= 0
            out += np.bincount(idx[keep], weights=v[keep], minlength=grid.N_CELLS)
    return out


# ---------------------------------------------------------------------------------------------------------------
# National bake
# ---------------------------------------------------------------------------------------------------------------


class NationalGrid:
    """30" grid aligned with WorldPop's 3" grid: national cell (R, C) = WorldPop pixels (10R.., 10C..)."""

    def __init__(self, lon_w: float, lat_n: float, px_rows: int, px_cols: int):
        self.lon_w, self.lat_n = lon_w, lat_n
        self.rows, self.cols = -(-px_rows // BLOCK), -(-px_cols // BLOCK)

    def index(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        r = np.floor((self.lat_n - lat) / NAT_DEG).astype(np.int64)
        c = np.floor((lon - self.lon_w) / NAT_DEG).astype(np.int64)
        inside = (r >= 0) & (r < self.rows) & (c >= 0) & (c < self.cols)
        return np.where(inside, r * self.cols + c, -1)

    def lat_of_row(self) -> np.ndarray:
        return self.lat_n - (np.arange(self.rows) + 0.5) * NAT_DEG


def _worldpop_national() -> tuple[NationalGrid, np.ndarray]:
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(worldpop_path()) as d:
        t = d.transform
        # The file stores 0.00083333333 (rounded): over its 51,646 columns that is ~2 cm off 1/1200 degree.
        if abs(t.a - PX_DEG) > 1e-9 or abs(t.e + PX_DEG) > 1e-9:
            raise RuntimeError(f"WorldPop pixel is not 3 arc-seconds: {t}")
        ng = NationalGrid(t.c, t.f, d.height, d.width)
        home = np.zeros((ng.rows, ng.cols), dtype=np.float64)
        step = BLOCK * 200
        for r0 in range(0, d.height, step):
            a = d.read(1, window=Window(0, r0, d.width, min(step, d.height - r0))).astype(np.float64)
            a[a == d.nodata] = 0.0
            if (a < 0).any() or not np.isfinite(a).all():
                raise RuntimeError(f"WorldPop: negative or non-finite values in rows {r0}..")
            b = block_sum(a, BLOCK)
            home[r0 // BLOCK : r0 // BLOCK + b.shape[0]] = b[:, : ng.cols]
    return ng, home


def _foreign_mask(ng: NationalGrid) -> np.ndarray:
    """True for national cells whose centre lies in Argentina, Bolivia or Peru."""
    import rasterio.features
    from affine import Affine

    geoms = []
    for p in neighbour_paths():
        geoms += [f["geometry"] for f in json.loads(p.read_text())["features"]]
    tr = Affine(NAT_DEG, 0, ng.lon_w, 0, -NAT_DEG, ng.lat_n)
    return rasterio.features.rasterize(
        [(g, 1) for g in geoms], out_shape=(ng.rows, ng.cols), transform=tr, all_touched=False, dtype="uint8"
    ).astype(bool)


def _ghsl_national(ng: NationalGrid) -> np.ndarray:
    """Non-residential building volume (m3) per national cell: every GHSL pixel goes to the cell holding its centre (GHSL's grid is
    offset by half a 3" pixel from WorldPop's: at most ~46 m of misplacement, well under a 1 km cell)."""
    import rasterio

    nres = np.zeros(ng.rows * ng.cols, dtype=np.float64)
    for p in ghsl_paths():
        with rasterio.open(p) as d:
            a = d.read(1)
            t = d.transform
        r, c = np.nonzero(a)
        lon = t.c + (c + 0.5) * t.a
        lat = t.f + (r + 0.5) * t.e
        idx = ng.index(lon, lat)
        keep = idx >= 0
        nres += np.bincount(idx[keep], weights=a[r[keep], c[keep]].astype(np.float64), minlength=nres.size)
    return nres.reshape(ng.rows, ng.cols)


def bake_national() -> dict:
    ng, home = _worldpop_national()
    foreign = _foreign_mask(ng)
    nres_all = _ghsl_national(ng)
    nres = np.where(foreign, 0.0, nres_all)
    foreign_home = float(home[foreign].sum())
    work, stay = gravity(home, nres, ng.lat_of_row(), NAT_DEG)
    if abs(work.sum() - home.sum()) > 1e-6 * home.sum():
        raise RuntimeError(f"gravity lost people: home {home.sum():.0f} vs work {work.sum():.0f}")
    if (work < 0).any():
        raise RuntimeError("gravity produced negative workers")

    keep = np.flatnonzero((home.ravel() > 0) | (work.ravel() > 0) | (nres.ravel() > 0))
    NATIONAL_DIR.mkdir(parents=True, exist_ok=True)
    with open(NATIONAL_BIN, "wb") as f:
        keep.astype("<u4").tofile(f)
        home.ravel()[keep].astype("<f4").tofile(f)
        work.ravel()[keep].astype("<f4").tofile(f)
        nres.ravel()[keep].astype("<f4").tofile(f)
    totals = {
        "home": round(float(home.sum())),
        "work": round(float(work.sum())),
        "stayHome": round(float(stay.sum())),
        "nonResidentialMillionM3": round(float(nres.sum()) / 1e6, 1),
    }
    meta = {
        "version": 1,
        "lonMin": ng.lon_w,
        "latMax": ng.lat_n,
        "dLon": NAT_DEG,
        "dLat": NAT_DEG,
        "rows": ng.rows,
        "cols": ng.cols,
        "n": int(keep.size),
        "layout": "little-endian: uint32 cell[n] (r * cols + c, row 0 north, ascending), float32 home[n], "
        "float32 work[n], float32 nonResidentialM3[n]",
        "commute": {"scaleM": COMMUTE_SCALE_M, "maxM": COMMUTE_MAX_M},
        "totals": totals,
        "source": SOURCE,
    }
    NATIONAL_JSON.write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    return {
        "grid": f"{ng.rows} x {ng.cols} cells of 30 arc-seconds",
        "cells_kept": int(keep.size),
        **totals,
        "nonResidentialForeignMillionM3": round(float(nres_all[foreign].sum()) / 1e6, 1),
        "homeInForeignCells": round(foreign_home),
        "bin_mb": round(NATIONAL_BIN.stat().st_size / 1e6, 2),
    }


def load_national() -> tuple[NationalGrid, dict, dict[str, np.ndarray]]:
    """Reads the committed national product. Raises if it is missing or inconsistent."""
    if not NATIONAL_JSON.exists() or not NATIONAL_BIN.exists():
        raise RuntimeError(f"{NATIONAL_JSON} missing: run `make population` (cd pipeline && uv run python bake_population.py)")
    meta = json.loads(NATIONAL_JSON.read_text())
    n = meta["n"]
    raw = np.fromfile(NATIONAL_BIN, dtype="u1")
    if raw.size != 16 * n:
        raise RuntimeError(f"{NATIONAL_BIN.name}: {raw.size} bytes, expected {16 * n}")
    cells = raw[: 4 * n].view("<u4").astype(np.int64)
    layers = {k: raw[4 * n * (i + 1) : 4 * n * (i + 2)].view("<f4").astype(np.float64) for i, k in enumerate(("home", "work", "nres"))}
    ng = NationalGrid(meta["lonMin"], meta["latMax"], meta["rows"] * BLOCK, meta["cols"] * BLOCK)
    if ng.rows != meta["rows"] or ng.cols != meta["cols"]:
        raise RuntimeError("population_cl.json: rows/cols inconsistent")
    if (np.diff(cells) <= 0).any() or cells[0] < 0 or cells[-1] >= ng.rows * ng.cols:
        raise RuntimeError("population_cl.bin: cell indices not ascending or out of range")
    layers["cell"] = cells
    return ng, meta, layers


# ---------------------------------------------------------------------------------------------------------------
# Domain bake (the 60 m simulation grid)
# ---------------------------------------------------------------------------------------------------------------


def _read_window(path: Path, west: float, south: float, east: float, north: float) -> tuple[np.ndarray, float, float]:
    """Pixels of a 4326 raster covering the bbox (+1 pixel margin), nodata -> 0. Returns (array, lon_w, lat_n)."""
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(path) as d:
        t = d.transform
        c0 = max(0, int(math.floor((west - t.c) / t.a)) - 1)
        c1 = min(d.width, int(math.ceil((east - t.c) / t.a)) + 1)
        r0 = max(0, int(math.floor((t.f - north) / -t.e)) - 1)
        r1 = min(d.height, int(math.ceil((t.f - south) / -t.e)) + 1)
        if c1 <= c0 or r1 <= r0:
            return np.zeros((0, 0)), t.c, t.f
        a = d.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype(np.float64)
        if d.nodata is not None:
            a[a == d.nodata] = 0.0
        return a, t.c + c0 * t.a, t.f + r0 * t.e


def bake_domain() -> dict:
    ng, meta, nat = load_national()
    w, s, e, n = grid.bbox()
    # National cells overlapping the domain (whole cells: refinement is per national cell).
    lookup = {k: np.zeros(ng.rows * ng.cols, dtype=np.float64) for k in ("home", "work", "nres")}
    for k in lookup:
        lookup[k][nat["cell"]] = nat[k]

    pop, pw, pn = _read_window(worldpop_path(), w, s, e, n)
    pr, pc = np.indices(pop.shape)
    parent_pop = ng.index(pw + (pc + 0.5) * PX_DEG, pn - (pr + 0.5) * PX_DEG)
    if (parent_pop < 0).any():
        raise RuntimeError("domain extends outside the national grid")
    # Per national cell: home is WorldPop as is. Work = NRES pixel share of the cell's workers where the cell has
    # non-residential volume, else the stay-at-home residents in proportion to home.
    home_cell = lookup["home"][parent_pop]
    stay_frac = np.where((lookup["nres"][parent_pop] == 0) & (home_cell > 0), lookup["work"][parent_pop] / np.maximum(home_cell, 1e-30), 0.0)
    work_from_home = pop * stay_frac

    nres_px = []
    for p in ghsl_paths():
        a, aw, an = _read_window(p, w, s, e, n)
        if a.size:
            nres_px.append((a, aw, an))
    if not nres_px:
        raise RuntimeError("no GHSL tile covers the simulation grid: fix GHSL_TILES")
    home60 = supersample_bin(pop, pw, pn, PX_DEG, SUPERSAMPLE, grid.cell_index)
    work60 = supersample_bin(work_from_home, pw, pn, PX_DEG, SUPERSAMPLE, grid.cell_index)
    for a, aw, an in nres_px:
        r, c = np.indices(a.shape)
        parent = ng.index(aw + (c + 0.5) * PX_DEG, an - (r + 0.5) * PX_DEG)
        cell_nres = np.where(parent >= 0, lookup["nres"][np.maximum(parent, 0)], 0.0)
        density = np.where(cell_nres > 0, lookup["work"][np.maximum(parent, 0)] / np.maximum(cell_nres, 1e-30), 0.0)
        work60 += supersample_bin(a * density, aw, an, PX_DEG, SUPERSAMPLE, grid.cell_index)

    for name, arr in (("population_home.bin", home60), ("population_work.bin", work60)):
        if not np.isfinite(arr).all() or (arr < 0).any():
            raise RuntimeError(f"{name}: negative or non-finite values")
        arr.astype("<f4").tofile(grid.OUT_DIR / name)
    return {
        "home_total": round(float(home60.sum())),
        "work_total": round(float(work60.sum())),
        "home_max_per_cell": round(float(home60.max()), 1),
        "work_max_per_cell": round(float(work60.max()), 1),
        "cells_with_residents": int((home60 > 0).sum()),
        "cells_with_workers": int((work60 > 0).sum()),
    }
