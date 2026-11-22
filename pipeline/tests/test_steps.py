"""Unit tests for the non-trivial pure logic of the pipeline (no network)."""

from __future__ import annotations

import numpy as np
import pytest

from steps import events, fuel, goes, grid, perimeter, roads, scar, wui


def test_cell_index_corners_and_outside():
    # Centre of cell (0, 0) and of the last cell.
    lon0 = grid.LON_MIN + 0.5 * grid.D_LON
    lat0 = grid.LAT_MAX - 0.5 * grid.D_LAT
    assert grid.cell_index(lon0, lat0) == 0
    lon1 = grid.LON_MIN + (grid.COLS - 0.5) * grid.D_LON
    lat1 = grid.LAT_MAX - (grid.ROWS - 0.5) * grid.D_LAT
    assert grid.cell_index(lon1, lat1) == grid.N_CELLS - 1
    # Row-major: one row south is +COLS.
    assert grid.cell_index(lon0, lat0 - grid.D_LAT) == grid.COLS
    # Outside on every side.
    assert grid.cell_index(grid.LON_MIN - 1e-6, lat0) == -1
    assert grid.cell_index(lon0, grid.LAT_MAX + 1e-6) == -1
    assert grid.cell_index(grid.LON_MAX + 1e-6, lat0) == -1
    assert grid.cell_index(lon0, grid.LAT_MIN - 1e-6) == -1


def test_grid_extent_matches_contract():
    assert grid.ROWS * grid.COLS == grid.N_CELLS
    assert grid.LAT_MIN == pytest.approx(-33.215, abs=1e-3)
    assert grid.LON_MAX == pytest.approx(-71.285, abs=1e-3)


def test_classify_mapping_and_urban_split():
    wc = np.array([10, 20, 30, 40, 50, 50, 60, 80, 90, 95, 100, 20, 30], dtype=np.uint8)
    cov = np.array([0, 0, 0, 0, 0.10, 0.15, 0, 0, 0, 0, 0, 0.30, 0.24])
    got = fuel.classify(wc, cov)
    f = fuel
    assert got.tolist() == [
        f.FOREST,
        f.SHRUB,
        f.GRASS,
        f.CROP,
        f.URBAN_LOW,
        f.URBAN_DENSE,  # built-up split at 15 % roof coverage
        f.NONE,
        f.NONE,
        f.GRASS,
        f.FOREST,
        f.GRASS,
        f.URBAN_DENSE,  # shrub with 30 % roofs -> dense urban
        f.GRASS,  # grass with 24 % roofs stays grass
    ]


def test_classify_rejects_unknown_class():
    with pytest.raises(ValueError):
        fuel.classify(np.array([0], dtype=np.uint8), np.zeros(1))


def test_classify_wui_splits_built_up_by_neighbourhood_green_not_roofs():
    f = fuel
    wc = np.array([50, 50, 50, 50, 10, 10, 10, 30, 60, 80], dtype=np.uint8)
    cov = np.array([0.30, 0.30, 0.05, 0.05, 0.10, 0.30, 0.30, 0.00, 0.40, 0.00])
    green = np.array([0.60, 0.20, 0.40, 0.39, 0.00, 0.90, 0.10, 0.00, 0.90, 0.90])
    got = wui.classify_wui(wc, cov, green)
    assert got.tolist() == [
        f.URBAN_LOW,  # built-up, many roofs, lots of vegetation around: intermix
        f.URBAN_DENSE,  # built-up, many roofs, little vegetation: consolidated
        f.URBAN_LOW,  # built-up, few roofs, green exactly at the threshold: intermix
        f.URBAN_DENSE,  # built-up, few roofs, just under the threshold: consolidated (old rule: URBAN_LOW)
        f.FOREST,  # tree cover with 10 % roofs keeps its vegetation class
        f.URBAN_LOW,  # tree cover with 30 % roofs counts as built-up, green -> intermix
        f.URBAN_DENSE,  # same roofs, little green -> consolidated
        f.GRASS,
        f.NONE,  # bare ground never becomes urban, whatever its roofs or green
        f.NONE,  # water
    ]
    assert wui.INTERMIX_GREEN == 0.40  # the thresholds above assume it
    with pytest.raises(ValueError):
        wui.classify_wui(np.array([0], dtype=np.uint8), np.zeros(1), np.zeros(1))


def test_classify_wui_matches_fuel_bin_outside_built_up_cells():
    rng = np.random.default_rng(0)
    wc = rng.choice(fuel.WC_CLASSES, size=2000).astype(np.uint8)
    cov = rng.uniform(0, 0.5, size=2000)
    green = rng.uniform(0, 1, size=2000)
    old, new = fuel.classify(wc, cov), wui.classify_wui(wc, cov, green)
    built = (wc == 50) | (np.isin(old, fuel.VEGETATION + (fuel.URBAN_DENSE,)) & (cov >= wui.VEG_TO_URBAN_COVERAGE))
    assert (old[~built] == new[~built]).all()
    assert np.isin(new[built], (fuel.URBAN_LOW, fuel.URBAN_DENSE)).all()


def test_neighbourhood_green_disk_mean_edges_and_missing_ndvi():
    veg = np.zeros(25)
    ndvi_green = np.zeros(25)
    ndvi_green[12] = 1.0  # centre of a 5x5 raster is fully green by NDVI
    g = wui.neighbourhood_green(veg, ndvi_green, (5, 5), 1).reshape(5, 5)
    assert g[2, 2] == pytest.approx(1 / 5)  # radius-1 disk = centre + 4 neighbours
    assert g[1, 2] == pytest.approx(1 / 5) and g[1, 1] == 0.0  # diagonals are outside a radius-1 disk
    # Corner: only 3 of the 5 disk cells are inside the raster, and the mean is over those 3.
    veg2 = np.zeros(25)
    veg2[0] = 0.9
    g2 = wui.neighbourhood_green(veg2, np.full(25, np.nan), (5, 5), 1).reshape(5, 5)
    assert g2[0, 0] == pytest.approx(0.9 / 3)  # NaN NDVI (no valid pixel) -> WorldCover share alone
    # max(), not sum: a cell green by both sources counts once.
    g3 = wui.neighbourhood_green(np.full(25, 0.5), np.full(25, 0.7), (5, 5), 2)
    assert np.allclose(g3, 0.7)


def test_vegetation_share_and_slope():
    k = len(fuel.WC_CLASSES)
    counts = np.zeros((2, k), dtype=np.int64)
    counts[0, fuel.WC_CLASSES.index(10)] = 30
    counts[0, fuel.WC_CLASSES.index(50)] = 10
    counts[0, fuel.WC_CLASSES.index(30)] = 10
    counts[1, fuel.WC_CLASSES.index(60)] = 50
    assert wui.vegetation_share(counts).tolist() == pytest.approx([0.8, 0.0])
    # A plane rising 10 degrees eastward on 60 m cells.
    elev = np.tile(np.arange(6) * 60 * np.tan(np.radians(10)), (4, 1))
    assert np.allclose(wui.slope_deg(elev, 60), 10)


def _line(n0: int, n: int, lon0: float, lat0: float) -> tuple[list[int], dict[int, tuple[float, float]]]:
    ids = list(range(n0, n0 + n))
    return ids, {i: (lon0 + 0.001 * k, lat0) for k, i in enumerate(ids)}


def test_build_graph_splits_at_shared_nodes_and_drops_small_components():
    # A long way of 25 OSM nodes crossed in its middle by a second way: 3 graph nodes on way A
    # (2 ends + the crossing) + 2 ends of way B.
    a_ids, coords = _line(0, 25, -71.5, -33.1)
    b_ids = [100, a_ids[12], 101]
    coords[100] = (coords[a_ids[12]][0], -33.099)
    coords[101] = (coords[a_ids[12]][0], -33.101)
    # Pad the big component past the minimum size with a chain of 20 short ways hanging off way A's end.
    chain = []
    prev = a_ids[-1]
    for k in range(20):
        nid = 200 + k
        coords[nid] = (coords[prev][0] + 0.001, -33.1)
        chain.append(([prev, nid], roads.PATH))
        prev = nid
    # A tiny isolated component (2 nodes) that must be dropped.
    coords[900], coords[901] = (-71.4, -33.0), (-71.401, -33.0)
    ways = [(a_ids, roads.LOCAL), (b_ids, roads.PRIMARY), *chain, ([900, 901], roads.LOCAL)]
    nodes, edges, geoms = roads.build_graph(ways, coords)

    assert len(nodes) == 3 + 2 + 20
    assert len(edges) == 2 + 2 + 20
    assert len(geoms) == len(edges)
    # Way A is split at the crossing into two stretches of 13 OSM nodes each.
    a_edges = [(e, g) for e, g in zip(edges, geoms) if e[3] == roads.LOCAL]
    assert sorted(len(g) for _, g in a_edges) == [13, 13]
    for (u, v, length, _), g in a_edges:
        assert tuple(nodes[u]) == tuple(g[0]) and tuple(nodes[v]) == tuple(g[-1])
        assert length == pytest.approx(12 * 0.001 * 111320 * np.cos(np.radians(33.1)), rel=0.01)
    assert all(0 <= u < len(nodes) and 0 <= v < len(nodes) for u, v, _, _ in edges)
    assert (-71.4, -33.0) not in [tuple(n) for n in nodes]
    # Every polyline starts and ends exactly at its edge's nodes (same float values, same rounding later).
    for (u, v, _, _), g in zip(edges, geoms):
        assert g[0] == nodes[u] and g[-1] == nodes[v]
        assert all(type(x) is float for p in g for x in p)


def test_simplify_keeps_ends_and_drops_collinear_points():
    pts = [(-71.5 + 0.0001 * k, -33.1) for k in range(10)]
    assert roads.simplify(pts, 1.0) == [pts[0], pts[-1]]
    bent = pts[:5] + [(-71.4995, -33.0995)] + pts[6:]  # a 50 m bump in the middle survives
    assert (-71.4995, -33.0995) in roads.simplify(bent, 1.0)


def test_keep_firms_connected():
    burned = np.zeros((20, 20), dtype=bool)
    burned[2:6, 2:6] = True  # patch near a detection
    burned[14:18, 14:18] = True  # unrelated patch far away
    firms_cell = np.array([7 * 20 + 4])  # (7, 4): 2 cells south of the first patch's edge (5, 4)
    kept = scar.keep_firms_connected(burned, firms_cell, radius_cells=2)
    assert kept[2:6, 2:6].all()
    assert not kept[14:18, 14:18].any()
    # Out of reach with a radius of 1: nothing is kept.
    assert not scar.keep_firms_connected(burned, firms_cell, radius_cells=1).any()


def test_remove_small_patches_keeps_large_and_diagonal_connected():
    m = np.zeros((12, 12), dtype=bool)
    m[1:4, 1:4] = True  # 9 px: kept
    m[1, 9] = m[2, 10] = True  # 2 px diagonal: removed
    m[6, 1] = m[7, 2] = m[8, 3] = m[9, 4] = m[10, 5] = m[11, 6] = m[10, 7] = m[9, 8] = m[8, 9] = True
    # ^ a 9-px diagonal line (8-connected): kept, unlike with a 3x3 binary opening
    out = scar.remove_small_patches(m, 9)
    assert out[1:4, 1:4].all()
    assert not out[1, 9] and not out[2, 10]
    assert out[6, 1] and out[11, 6] and out[8, 9]


def test_split_runs_clips_ways_to_the_grid():
    keep = {1, 2, 3, 5, 7, 8}
    assert roads.split_runs([1, 2, 3, 4, 5, 6, 7, 8], keep) == [[1, 2, 3], [7, 8]]  # lone 5 is dropped
    assert roads.split_runs([4, 6], keep) == []
    assert roads.split_runs([1, 2], keep) == [[1, 2]]


def test_goes_fixed_grid_pug_example():
    # GOES-R PUG vol. 3, section 5.1.2.8.1 worked example (x, y in radians -> geodetic lat, lon).
    lon, lat = goes.fixed_grid_to_lonlat(
        np.array([-0.024052]), np.array([0.095340]), -75.0, 35786023.0, 6378137.0, 6356752.31414
    )
    assert lat[0] == pytest.approx(33.846162, abs=1e-4)
    assert lon[0] == pytest.approx(-84.690932, abs=1e-4)


def test_goes_mask_codes_keep_fire_categories_but_not_low_probability():
    for code in (10, 11, 12, 13, 14, 30, 31, 32, 33, 34):
        assert code in goes.FIRE_MASK_CODES
    for code in (0, 15, 35, 40, 100):
        assert code not in goes.FIRE_MASK_CODES


def test_goes_scan_time_is_mid_scan_local():
    name = "OR_ABI-L2-FDCF-M6_G16_s20240332100208_e20240332109516_c20240332113362.nc"
    # Scan start 2024 day 033 21:00:20.8 UTC = 2 Feb 18:00 local; +5 min to mid-scan.
    assert goes.scan_time_local(name) == "2024-02-02T18:05"


@pytest.fixture
def restore_default_event():
    yield
    grid.select(events.DEFAULT)


@pytest.mark.parametrize("event_id", sorted(events.EVENTS))
def test_committed_grid_json_matches_the_event(event_id, restore_default_event):
    # The "Fuentes" panel reads grid.json; a source added to an event must reach the committed file, and the
    # committed grid must be the one the event defines.
    import json

    import bake

    ev = grid.select(event_id)
    meta = json.loads((grid.OUT_DIR / "grid.json").read_text())
    assert meta["sources"] == bake.sources(ev)
    assert {k: meta[k] for k in ("rows", "cols", "latMax", "lonMin", "dLat", "dLon", "t0")} == {
        "rows": grid.ROWS,
        "cols": grid.COLS,
        "latMax": grid.LAT_MAX,
        "lonMin": grid.LON_MIN,
        "dLat": grid.D_LAT,
        "dLon": grid.D_LON,
        "t0": grid.T0,
    }


def test_default_event_is_the_vina_grid():
    assert events.DEFAULT == "vina-2024"
    assert grid.EVENT.id == "vina-2024"
    assert grid.OUT_DIR == grid.DATA_ROOT and grid.CACHE_DIR == grid.CACHE_ROOT


@pytest.mark.parametrize("event_id", sorted(events.EVENTS))
def test_event_definitions_are_consistent(event_id, restore_default_event):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    ev = grid.select(event_id)
    assert grid.N_CELLS <= grid.MAX_CELLS
    # dLon uses the centre latitude of the grid.
    assert abs(ev.ref_lat - abs(grid.LAT_MAX - grid.ROWS * grid.D_LAT / 2)) < 0.01
    # The fixed UTC offset holds over the whole baked window, and t0 carries it.
    tz = ZoneInfo(ev.timezone)
    assert datetime.fromisoformat(ev.t0).utcoffset() == timedelta(hours=ev.utc_offset_h)
    days = (ev.weather_first_day, ev.weather_last_day)
    days += (ev.firms_first, ev.firms_last) if ev.observed_fire else ()
    for day in days:
        assert datetime.fromisoformat(day).replace(tzinfo=tz).utcoffset() == timedelta(hours=ev.utc_offset_h)
    for t in (ev.goes_first_utc, ev.goes_last_utc) if ev.observed_fire else ():
        assert t.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz).utcoffset() == timedelta(hours=ev.utc_offset_h)
    # Every fixed ignition preset is in the grid and has the ignitions.json shape.
    for p in ev.ignitions or ():
        assert set(p) == {"id", "label", "lon", "lat", "timeLocal", "source"}
        assert grid.cell_index(p["lon"], p["lat"]) >= 0
    if ev.observed_fire:
        assert ev.s2_pre.split("_")[1] == ev.s2_post.split("_")[1]  # same MGRS tile: same pixel grid
    else:
        assert "goes.json" not in ev.outputs and ev.ignitions  # hypothetical: fixed presets, no GOES


def test_hypothetical_event_sets_no_fire_fields_or_all_of_them():
    from dataclasses import replace

    talca = events.EVENTS["talca"]
    assert not talca.observed_fire
    assert all(getattr(talca, f) is None for f in events.FIRE_FIELDS)
    with pytest.raises(ValueError, match="or none"):
        replace(talca, s2_post="S2B_19HBA_20260318_0_L2A")  # a post scene without the rest of a real fire
    with pytest.raises(ValueError, match="ignition presets"):
        replace(talca, ignitions=None)


def test_unknown_event_raises():
    with pytest.raises(ValueError, match="unknown event"):
        grid.select("nope")


def test_scene_url_from_the_scene_id():
    assert scar._url("S2B_19HBD_20240118_0_L2A", "B12") == (
        "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/19/H/BD/2024/1/S2B_19HBD_20240118_0_L2A/B12.tif"
    )
    assert scar._url("S2C_11SLT_20250221_0_L2A", "SCL") == (
        "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/11/S/LT/2025/2/S2C_11SLT_20250221_0_L2A/SCL.tif"
    )


def test_perimeter_rasterises_cell_centres(restore_default_event):
    grid.select("eaton-2025")
    # A square covering exactly cells (r, c) for r in 10..12 and c in 20..23 (edges on cell boundaries, so only
    # those cell centres are inside).
    w, e = grid.LON_MIN + 20 * grid.D_LON, grid.LON_MIN + 24 * grid.D_LON
    n, s = grid.LAT_MAX - 10 * grid.D_LAT, grid.LAT_MAX - 13 * grid.D_LAT
    sq = {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
    got = perimeter.rasterize(sq).reshape(grid.ROWS, grid.COLS)
    assert got.sum() == 12
    assert got[10:13, 20:24].all()
    with pytest.raises(RuntimeError, match="Polygon"):
        perimeter.rasterize({"type": "Point", "coordinates": [w, n]})
