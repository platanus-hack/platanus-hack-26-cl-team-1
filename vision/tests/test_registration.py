import cv2
import numpy as np
import pytest

from tests.synth import frame_of_mat, project
from vision import mat
from vision.registration import Registration, grid_to_hole

NOMINAL_B = np.diag([mat.GRID_MM, mat.GRID_MM, 1.0])


def gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def test_grid_to_hole():
    assert grid_to_hole(11, 9) == "e10"
    assert grid_to_hole(11.4, 8.6) == "e10"
    assert grid_to_hole(11.6, 9) == "e11"
    assert grid_to_hole(11, 10.5) is None  # centre channel
    assert grid_to_hole(4, 1) == "T+3"
    assert grid_to_hole(7, 1) is None  # rails skip col 6
    assert grid_to_hole(0, 5) is None


@pytest.mark.parametrize(
    "quad",
    [
        None,  # mild perspective
        [(10, 10), (630, 10), (630, 470), (10, 470)],  # top-down, fills the frame
        [(90, 120), (560, 90), (630, 400), (30, 450)],  # stronger angle
    ],
)
def test_markers_give_exact_holes(quad):
    img, A = frame_of_mat(quad, noise=4)
    reg = Registration()
    up = reg.update(gray(img))
    assert up.markers == 4 and up.ok and up.changed
    holes = mat.all_holes()
    misses = [h for h in holes if reg.pixel_to_hole(*project(A, NOMINAL_B, h)) != h]
    assert not misses, misses[:10]
    # round trip hole → pixel lands within 1 px of the truth (a hole pitch is ~6-9 px here)
    err = max(np.hypot(*(np.array(reg.hole_to_pixel(h)) - project(A, NOMINAL_B, h))) for h in ("a1", "j30", "e15"))
    assert err < 1.0


def test_keeps_homography_when_markers_are_covered():
    img, _ = frame_of_mat()
    reg = Registration()
    reg.update(gray(img))
    H0 = reg.H.copy()
    covered = img.copy()
    covered[:, :200] = 128  # a hand over markers 0 and 3
    up = reg.update(gray(covered))
    assert up.markers == 2 and up.ok and not up.changed
    assert np.allclose(reg.H, H0)


def test_ignores_jitter_but_follows_real_moves():
    img, _ = frame_of_mat()
    reg = Registration()
    reg.update(gray(img))
    img2, _ = frame_of_mat(noise=6, seed=3)
    assert not reg.update(gray(img2)).changed  # same pose, only noise
    moved, A2 = frame_of_mat([(60, 80), (630, 60), (640, 430), (40, 455)])
    assert reg.update(gray(moved)).changed
    assert reg.pixel_to_hole(*project(A2, NOMINAL_B, "f22")) == "f22"


def test_click_refinement_models_the_raised_breadboard(tmp_path):
    """The breadboard surface is not where the nominal mapping says: clicks fix it and survive a camera bump."""
    img, A = frame_of_mat()
    # "Real" hole plane: shifted 1.6 mm right / 1.1 mm down and 1.5 % bigger than nominal.
    B_real = np.array([[mat.GRID_MM * 1.015, 0, 1.6], [0, mat.GRID_MM * 1.015, 1.1], [0, 0, 1]])
    reg = Registration(calib_path=tmp_path / "calib.json")
    reg.update(gray(img))
    wrong = sum(reg.pixel_to_hole(*project(A, B_real, h)) != h for h in mat.all_holes())
    assert wrong > 50  # nominal mapping is off by about a hole on that side
    clicks = {h: project(A, B_real, h) for h in ("a1", "a30", "j1", "j30")}
    assert reg.refine_with_clicks(clicks) is None
    assert all(reg.pixel_to_hole(*project(A, B_real, h)) == h for h in mat.all_holes())
    # camera bumped: markers track it, refinement still applies; and it is persisted
    moved, A2 = frame_of_mat([(60, 80), (630, 60), (640, 430), (40, 455)])
    reg2 = Registration(calib_path=tmp_path / "calib.json")
    assert reg2.refined
    reg2.update(gray(moved))
    assert all(reg2.pixel_to_hole(*project(A2, B_real, h)) == h for h in mat.all_holes())


def test_refinement_needs_markers_and_all_clicks():
    reg = Registration()
    assert "marcadores" in reg.refine_with_clicks({})
    img, A = frame_of_mat()
    reg.update(gray(img))
    assert "a30" in reg.refine_with_clicks({"a1": (1.0, 2.0)})
