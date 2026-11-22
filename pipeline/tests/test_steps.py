"""Unit tests for the non-trivial pure logic of the pipeline (no network)."""

from __future__ import annotations

import numpy as np
import pytest

from steps import fuel, grid, roads, scar


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
