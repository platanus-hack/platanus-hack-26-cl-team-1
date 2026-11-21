from fastapi.testclient import TestClient

from vision import mat
from vision.app import app
from vision.tools import make_markers


def test_health_without_gpu_or_vllm(monkeypatch):
    monkeypatch.setenv("VLLM_URL", "http://127.0.0.1:9")
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "gpu" in body and "vllm" in body


def test_hole_grid_matches_catalog():
    assert mat.hole_grid("a1") == (2, 5)
    assert mat.hole_grid("e10") == (11, 9)
    assert mat.hole_grid("j30") == (31, 16)
    assert mat.hole_grid("T+3") == (4, 1)
    assert mat.hole_grid("B-29") == (30, 20)
    assert mat.hole_grid("T+6") is None  # rails skip every 6th column
    assert mat.hole_grid("k1") is None
    assert mat.hole_grid("a31") is None
    assert len(mat.all_holes()) == 300 + 4 * 25


def test_markers_render_and_detect(tmp_path):
    out = make_markers.main(["--out", str(tmp_path / "m.pdf")])
    assert out.exists() and out.stat().st_size > 10_000
