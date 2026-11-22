"""Unit tests for the population step's pure logic (no network): block sums, the gravity model and the
mass-conserving resampling onto the simulation grid."""

from __future__ import annotations

import math

import numpy as np
import pytest

from steps import grid, population as pop


def test_block_sum_pads_and_sums():
    a = np.arange(1, 13, dtype=float).reshape(3, 4)  # 3 x 4 -> 2 x 2 blocks of 2 x 2 (zero-padded row)
    got = pop.block_sum(a, 2)
    assert got.tolist() == [[1 + 2 + 5 + 6, 3 + 4 + 7 + 8], [9 + 10, 11 + 12]]
    assert got.sum() == a.sum()


def test_kernel_shape_centre_and_cutoff():
    k = pop.kernel(1000.0, 500.0, scale_m=2000.0, max_m=3000.0)
    assert k.shape == (7, 13)  # 3 cells north-south, 6 east-west each side
    assert k[3, 6] == 1.0
    assert k[3, 6 + 4] == pytest.approx(math.exp(-1.0))  # 2 km east
    assert k[0, 6] == pytest.approx(math.exp(-1.5))  # 3 km north: on the cut-off, kept
    assert k[0, 0] == 0.0  # corner, beyond 3 km
    assert np.array_equal(k, k[::-1, ::-1])  # symmetric


def _lat_rows(rows: int, lat0: float = -33.0, cell_deg: float = 0.01) -> np.ndarray:
    return lat0 - (np.arange(rows) + 0.5) * cell_deg


def test_gravity_conserves_people_and_sends_them_to_jobs_nearby():
    rng = np.random.default_rng(7)
    rows, cols = 90, 70
    home = np.where(rng.random((rows, cols)) < 0.3, rng.random((rows, cols)) * 100, 0.0)
    attract = np.zeros((rows, cols))
    attract[20, 20] = 5.0  # a big job centre
    attract[70, 50] = 1.0  # a small one
    work, stay = pop.gravity(home, attract, _lat_rows(rows), 0.01, scale_m=5000, max_m=15000, band_rows=25)
    assert work.sum() == pytest.approx(home.sum(), rel=1e-9)
    assert (work >= 0).all()
    # Workers end up only at job centres or at home (those with no job within 15 km stay).
    elsewhere = np.ones((rows, cols), bool)
    elsewhere[20, 20] = elsewhere[70, 50] = False
    assert np.allclose(work[elsewhere], stay[elsewhere])
    assert stay.sum() > 0
    # A resident next to the big centre and far (> 15 km) from the small one goes to the big one only.
    one = np.zeros((rows, cols))
    one[22, 22] = 10.0
    w1, s1 = pop.gravity(one, attract, _lat_rows(rows), 0.01, scale_m=5000, max_m=15000, band_rows=25)
    assert w1[20, 20] == pytest.approx(10.0)
    assert s1.sum() == 0


def test_gravity_splits_by_attraction_and_distance():
    rows, cols = 41, 41
    home = np.zeros((rows, cols))
    home[20, 20] = 100.0
    attract = np.zeros((rows, cols))
    attract[20, 25] = 1.0  # 5 cells east
    attract[20, 10] = 1.0  # 10 cells west
    lat = np.full(rows, 0.0)  # equator: square cells
    cell_deg = 1000 / pop.M_PER_DEG  # 1 km cells
    work, _ = pop.gravity(home, attract, lat, cell_deg, scale_m=5000, max_m=20000, band_rows=10)
    ke, kw = math.exp(-1.0), math.exp(-2.0)
    assert work[20, 25] == pytest.approx(100 * ke / (ke + kw), rel=1e-6)
    assert work[20, 10] == pytest.approx(100 * kw / (ke + kw), rel=1e-6)


def test_gravity_mass_is_exact_across_band_edges_at_high_latitude():
    # Bands of 3 rows over a long latitude range: kernels differ between bands, mass must still be conserved.
    rng = np.random.default_rng(3)
    rows, cols = 60, 40
    home = rng.random((rows, cols)) * 10
    attract = np.where(rng.random((rows, cols)) < 0.05, rng.random((rows, cols)), 0.0)
    work, _ = pop.gravity(home, attract, _lat_rows(rows, -40.0, 0.3), 0.3, scale_m=20000, max_m=60000, band_rows=3)
    assert work.sum() == pytest.approx(home.sum(), rel=1e-9)


def test_supersample_bin_conserves_mass_and_places_it():
    # One 3" pixel fully inside the grid near its north-west corner: all of it lands in the grid, in the
    # cells under the pixel.
    px = pop.PX_DEG
    lon_w = grid.LON_MIN + 2 * grid.D_LON
    lat_n = grid.LAT_MAX - 2 * grid.D_LAT
    vals = np.array([[0.0, 36.0], [0.0, 0.0]])
    out = pop.supersample_bin(vals, lon_w - px, lat_n, px, 6, grid.cell_index)
    assert out.sum() == pytest.approx(36.0)
    hit = np.flatnonzero(out)
    r, c = hit // grid.COLS, hit % grid.COLS
    assert r.min() >= 2 and c.min() >= 2 and r.max() <= 4 and c.max() <= 4
    # A pixel straddling the west edge loses exactly the part outside.
    out2 = pop.supersample_bin(np.array([[36.0]]), grid.LON_MIN - px / 2, lat_n, px, 6, grid.cell_index)
    assert out2.sum() == pytest.approx(18.0)


def test_national_grid_index():
    ng = pop.NationalGrid(-80.0, -17.0, 100, 50)
    assert (ng.rows, ng.cols) == (10, 5)
    eps = 1e-9
    assert ng.index(np.array([-80.0 + eps]), np.array([-17.0 - eps]))[0] == 0
    assert ng.index(np.array([-80.0 + 1.5 * pop.NAT_DEG]), np.array([-17.0 - 2.5 * pop.NAT_DEG]))[0] == 2 * 5 + 1
    assert ng.index(np.array([-80.1]), np.array([-17.5]))[0] == -1


def test_ghsl_tile_matches_the_tiles_on_disk_and_refuses_two_tiles():
    # Bounds read from the tiles: R6_C7 = lon -120.0079..-110.0079, lat 29.0996..39.0996.
    assert pop.ghsl_tile(-118.87, 33.55, -117.31, 34.82) == "R6_C7"  # Eaton's regional extent
    assert pop.ghsl_tile(-71.6, -33.2, -71.3, -33.0) == "R13_C11"  # Viña: one of GHSL_TILES
    assert all(f"R{r}_C{c}" in pop.GHSL_TILES for r in (11, 15) for c in (11, 12))
    assert pop.ghsl_tile(-120.0, 39.0, -119.9, 39.09) == "R6_C7"  # just inside the north-west corner
    with pytest.raises(RuntimeError, match="spans GHSL tiles"):
        pop.ghsl_tile(-120.01, 34.0, -119.9, 34.1)  # crosses the west edge (-120.0079)
    with pytest.raises(RuntimeError, match="spans GHSL tiles"):
        pop.ghsl_tile(-118.0, 39.0, -117.9, 39.2)  # crosses the north edge (39.0996)


def test_expand_bbox_grows_by_at_least_the_margin():
    w, s, e, n = pop.expand_bbox(-118.2, 34.1, -118.0, 34.27, 60_000.0)
    assert n - 34.27 == pytest.approx(60_000 / pop.M_PER_DEG)
    assert 34.1 - s == pytest.approx(60_000 / pop.M_PER_DEG)
    # East-west margin in metres, at the extent's most poleward latitude (where a degree is shortest), is 60 km.
    assert (-118.2 - w) * pop.M_PER_DEG * math.cos(math.radians(n)) == pytest.approx(60_000)
    assert (e + 118.0) * pop.M_PER_DEG * math.cos(math.radians(34.1)) > 60_000
    # Southern hemisphere: the most poleward latitude is the south edge.
    w2, s2, _, _ = pop.expand_bbox(-71.6, -33.2, -71.3, -33.0, 30_000.0)
    assert (-71.6 - w2) * pop.M_PER_DEG * math.cos(math.radians(s2)) == pytest.approx(30_000)
