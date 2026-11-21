"""F4 dataset tooling without GPU packages: labels, reviewer API, Qwen grounding parser, session split."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from vision import review
from vision.classes import CLASS_ID, CLASSES
from vision.tools import autolabel, make_dataset
from vision.tools.autolabel import match_class, parse_qwen_boxes
from vision.tools.make_dataset import SPLITS, assign_splits, make_groups
from vision.yolo_io import DELETED, REVIEWED, Box, format_yolo, label_path, parse_yolo, read_set

W, H = 640, 480


def flat(boxes: list[Box]) -> list[tuple[float, ...]]:
    return [(b.cls, b.x1, b.y1, b.x2, b.y2) for b in boxes]


def test_classes_order() -> None:
    assert CLASSES == (
        "arduino_uno",
        "led_red",
        "led_green",
        "led_yellow",
        "resistor",
        "button",
        "potentiometer",
        "buzzer",
        "wire_end",
        "hand",
    )


# --- label files ---------------------------------------------------------------------------------


def test_yolo_roundtrip() -> None:
    boxes = [Box(0, 10, 20, 330, 260), Box(8, 300.5, 200.25, 312.5, 214), Box(9, 0, 0, 640, 480)]
    text = format_yolo(boxes, W, H)
    assert text.splitlines()[0] == "0 0.265625 0.291667 0.500000 0.500000"
    back = parse_yolo(text, W, H)
    assert [b.cls for b in back] == [0, 8, 9]
    for a, b in zip(flat(boxes), flat(back), strict=True):
        assert a == pytest.approx(b, abs=1e-3)
    assert format_yolo(back, W, H) == text


def test_yolo_clamps_and_skips_garbage() -> None:
    text = "1 0.5 0.5 0.2 0.2\n\nnot a line\n99 0.5 0.5 0.1 0.1\n2 0.5 0.5 0.1\n3 1.0 1.0 0.4 0.4\n"
    boxes = parse_yolo(text, W, H)
    assert [b.cls for b in boxes] == [1, 3]
    assert (boxes[1].x2, boxes[1].y2) == (W, H)  # clamped to the image
    # inverted and out-of-image pixel boxes are normalised; degenerate ones dropped
    back = parse_yolo(format_yolo([Box(4, 700, 500, 600, 400), Box(5, 10, 10, 10.5, 50)], W, H), W, H)
    assert len(back) == 1 and flat(back)[0] == pytest.approx((4, 600, 400, 640, 480), abs=1e-3)


# --- Qwen3-VL grounding parser -------------------------------------------------------------------


def test_qwen_fenced_json() -> None:
    text = (
        "Aquí están:\n```json\n"
        '[{"label": "led_red", "bbox_2d": [500, 500, 550, 600]},\n'
        ' {"bbox_2d": [0, 0, 1000, 1000], "label": "Arduino Uno"},\n'
        ' {"label": "dog", "bbox_2d": [1, 2, 3, 4]}]\n```'
    )
    boxes = parse_qwen_boxes(text, W, H)
    assert [b.cls for b in boxes] == [CLASS_ID["led_red"], CLASS_ID["arduino_uno"]]
    assert (boxes[0].x1, boxes[0].y1, boxes[0].x2, boxes[0].y2) == pytest.approx((320, 240, 352, 288))
    assert (boxes[1].x2, boxes[1].y2) == (W, H)


def test_qwen_partial_and_sloppy_output() -> None:
    truncated = '[{"label": "wire_end", "bbox_2d": [100, 100, 120, 130]}, {"label": "resistor", "bbox_2d": [200, 3'
    assert [b.cls for b in parse_qwen_boxes(truncated, W, H)] == [CLASS_ID["wire_end"]]
    sloppy = "{'label': 'hand', 'bbox_2d': [900, 900, 1200, 1100]} {'label': 'potenciómetro', 'bbox_2d': [1,1,50,50]}"
    boxes = parse_qwen_boxes(sloppy, W, H)
    assert [b.cls for b in boxes] == [CLASS_ID["hand"], CLASS_ID["potentiometer"]]
    assert (boxes[0].x2, boxes[0].y2) == (W, H)  # clamped
    wrapped = '{"objects": [{"label": "button", "bbox": [10, 10, 20, 20]}]}'
    assert [b.cls for b in parse_qwen_boxes(wrapped, W, H)] == [CLASS_ID["button"]]
    single = '{"label": "buzzer", "bbox_2d": [10, 10, 20, 20]}'
    assert [b.cls for b in parse_qwen_boxes(single, W, H)] == [CLASS_ID["buzzer"]]
    assert parse_qwen_boxes("No veo nada.", W, H) == []
    assert parse_qwen_boxes("[]", W, H) == []
    assert parse_qwen_boxes('[{"label": "led_green", "bbox_2d": [5, 5, 5, 900]}]', W, H) == []  # zero width


def test_match_class_aliases() -> None:
    assert match_class("LED rojo") == CLASS_ID["led_red"]
    assert match_class("green LED") == CLASS_ID["led_green"]
    assert match_class("Botón") == match_class("boton") == CLASS_ID["button"]
    assert match_class("wire-end") == CLASS_ID["wire_end"]
    assert match_class("led") is None
    assert match_class(None) is None


# --- autolabel pipeline (fake engine) ------------------------------------------------------------


def make_jpeg(path: Path, color: tuple[int, int, int] = (40, 90, 60)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (W, H), color).save(path, "JPEG", quality=92)


def test_autolabel_layout_and_skips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    raw, out = tmp_path / "raw", tmp_path / "labeled"
    for name in ("1000_000001.jpg", "2000_000002.jpg", "3000_000003.jpg"):
        make_jpeg(raw / "sessA" / name)
    calls: list[list[Path]] = []

    def fake(paths: list[Path], args: argparse.Namespace):
        calls.append(paths)
        for p in paths:
            yield p, ([Box(CLASS_ID["resistor"], 100, 100, 200, 150)], W, H)

    monkeypatch.setitem(autolabel.ENGINES, "world", fake)
    autolabel.main(["--raw", str(raw), "--out", str(out)])
    assert (out / "images" / "sessA" / "2000_000002.jpg").is_file()
    assert parse_yolo(label_path(out, "sessA/2000_000002.jpg").read_text(), W, H)[0].cls == CLASS_ID["resistor"]

    # second run: labelled images are skipped; --force relabels all but reviewed/deleted ones
    autolabel.main(["--raw", str(raw), "--out", str(out)])
    assert len(calls) == 1
    (out / REVIEWED).write_text(json.dumps(["sessA/1000_000001.jpg"]))
    (out / DELETED).write_text(json.dumps(["sessA/3000_000003.jpg"]))
    autolabel.main(["--raw", str(raw), "--out", str(out), "--force"])
    assert [p.name for p in calls[-1]] == ["2000_000002.jpg"]


# --- reviewer API --------------------------------------------------------------------------------


@pytest.fixture
def review_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, Path]:
    monkeypatch.setenv("CV_DATA", str(tmp_path))
    root = tmp_path / "yolo" / "labeled"
    make_jpeg(root / "images" / "s1" / "1000_000001.jpg")
    make_jpeg(root / "images" / "s1" / "2000_000002.jpg", (200, 30, 30))
    label_path(root, "s1/1000_000001.jpg").parent.mkdir(parents=True)
    label_path(root, "s1/1000_000001.jpg").write_text(format_yolo([Box(1, 64, 48, 128, 96)], W, H))
    (tmp_path / "secret.jpg").write_bytes(b"not for you")
    app = FastAPI()
    app.include_router(review.router)
    return TestClient(app), root


def test_review_list_and_labels(review_env: tuple[TestClient, Path]) -> None:
    client, root = review_env
    assert client.get("/review").status_code == 200
    assert "Revisión" in client.get("/review/").text
    data = client.get("/review/api/images").json()
    assert [c["name"] for c in data["classes"]] == list(CLASSES)
    assert [i["path"] for i in data["images"]] == ["s1/1000_000001.jpg", "s1/2000_000002.jpg"]
    assert data["images"][0]["counts"][1] == 1 and not data["images"][0]["reviewed"]

    r = client.get("/review/api/image", params={"path": "s1/1000_000001.jpg"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"

    lbl = client.get("/review/api/labels", params={"path": "s1/1000_000001.jpg"}).json()
    assert (lbl["width"], lbl["height"]) == (W, H)
    assert lbl["boxes"] == [{"cls": 1, "x1": 64.0, "y1": 48.0, "x2": 128.0, "y2": 96.0}]
    assert client.get("/review/api/labels", params={"path": "s1/2000_000002.jpg"}).json()["boxes"] == []

    boxes = [
        {"cls": 8, "x1": 330, "y1": 250, "x2": 300, "y2": 200},
        {"cls": 9, "x1": 600, "y1": 400, "x2": 900, "y2": 900},
    ]
    r = client.put("/review/api/labels", params={"path": "s1/2000_000002.jpg"}, json={"boxes": boxes, "reviewed": True})
    assert r.status_code == 200
    assert r.json()["counts"][8] == 1 and r.json()["counts"][9] == 1 and r.json()["reviewed"]
    saved = parse_yolo(label_path(root, "s1/2000_000002.jpg").read_text(), W, H)
    assert len(saved) == 2
    assert flat(saved)[0] == pytest.approx((8, 300, 200, 330, 250), abs=1e-3)
    assert flat(saved)[1] == pytest.approx((9, 600, 400, 640, 480), abs=1e-3)
    assert read_set(root / REVIEWED) == {"s1/2000_000002.jpg"}

    r = client.put(
        "/review/api/labels",
        params={"path": "s1/2000_000002.jpg"},
        json={"boxes": [{"cls": 10, "x1": 0, "y1": 0, "x2": 9, "y2": 9}]},
    )
    assert r.status_code == 422  # unknown class

    client.post("/review/api/reviewed", params={"path": "s1/1000_000001.jpg"}, json={"reviewed": True})
    client.post("/review/api/reviewed", params={"path": "s1/2000_000002.jpg"}, json={"reviewed": False})
    assert read_set(root / REVIEWED) == {"s1/1000_000001.jpg"}


def test_review_delete(review_env: tuple[TestClient, Path]) -> None:
    client, root = review_env
    client.post("/review/api/reviewed", params={"path": "s1/1000_000001.jpg"}, json={"reviewed": True})
    assert client.delete("/review/api/image", params={"path": "s1/1000_000001.jpg"}).status_code == 200
    assert not (root / "images" / "s1" / "1000_000001.jpg").exists()
    assert not label_path(root, "s1/1000_000001.jpg").exists()
    assert read_set(root / REVIEWED) == set() and read_set(root / DELETED) == {"s1/1000_000001.jpg"}
    assert [i["path"] for i in client.get("/review/api/images").json()["images"]] == ["s1/2000_000002.jpg"]
    assert client.delete("/review/api/image", params={"path": "s1/1000_000001.jpg"}).status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "../../../secret.jpg",
        "s1/../../../../secret.jpg",
        "/etc/passwd.jpg",
        "..\\..\\secret.jpg",
        "s1/1000_000001.txt",
        "",
        "~/x.jpg",
    ],
)
def test_review_path_traversal(review_env: tuple[TestClient, Path], path: str) -> None:
    client, root = review_env
    for method, url in (("GET", "/review/api/image"), ("GET", "/review/api/labels"), ("DELETE", "/review/api/image")):
        r = client.request(method, url, params={"path": path})
        assert r.status_code == 400, (method, url, path, r.status_code)
    assert client.put("/review/api/labels", params={"path": path}, json={"boxes": []}).status_code == 400
    assert client.get("/review/api/image?path=..%2F..%2F..%2Fsecret.jpg").status_code == 400
    assert (root.parent.parent / "secret.jpg").read_bytes() == b"not for you"
    assert not list(root.parent.parent.glob("*.txt"))


# --- session-level split -------------------------------------------------------------------------


def test_assign_splits_by_group() -> None:
    sizes = {f"sess{i}": n for i, n in enumerate([120, 95, 80, 60, 55, 50, 40, 35, 30, 20, 15])}
    a = assign_splits(sizes, seed=3)
    assert set(a) == set(sizes) and set(a.values()) == set(SPLITS)  # every group in exactly one split
    assert a == assign_splits(sizes, seed=3)  # deterministic
    total = sum(sizes.values())
    share = {s: sum(n for g, n in sizes.items() if a[g] == s) / total for s in SPLITS}
    assert share["train"] == pytest.approx(0.8, abs=0.06)
    assert share["val"] == pytest.approx(0.1, abs=0.05)
    assert share["test"] == pytest.approx(0.1, abs=0.05)


def test_assign_splits_few_sessions() -> None:
    a = assign_splits({"a": 300, "b": 45, "c": 40})
    assert a["a"] == "train" and {a["b"], a["c"]} == {"val", "test"}
    assert set(assign_splits({"a": 10, "b": 10}).values()) <= set(SPLITS)


def test_make_groups_falls_back_to_time_blocks() -> None:
    # one session of 300 frames at 1 fps → 60 s blocks, never mixing frames across blocks
    rels = [f"only/{1_700_000_000_000 + i * 1000}_{i:06d}.jpg" for i in range(300)]
    groups = make_groups(rels, None)
    assert len(groups) == 5 and all(len(v) == 60 for v in groups.values())
    assert sorted(r for v in groups.values() for r in v) == sorted(rels)
    sessions = make_groups([f"s{k}/{i}_000.jpg" for k in range(4) for i in range(5)], None)
    assert sorted(sessions) == ["s0", "s1", "s2", "s3"]


def test_build_dataset(tmp_path: Path) -> None:
    src, out = tmp_path / "labeled", tmp_path / "v1"
    sizes = {"sA": 16, "sB": 2, "sC": 2}
    for s, n in sizes.items():
        for i in range(n):
            rel = f"{s}/{1000 * i}_{i:06d}.jpg"
            make_jpeg(src / "images" / rel)
            label_path(src, rel).parent.mkdir(parents=True, exist_ok=True)
            label_path(src, rel).write_text(format_yolo([Box(CLASS_ID["wire_end"], 10, 10, 30, 30)], W, H))
    make_jpeg(src / "images" / "sA" / "unlabeled.jpg")
    (src / REVIEWED).write_text(json.dumps(["sA/0_000000.jpg", "sB/0_000000.jpg", "sC/0_000000.jpg"]))

    summary = make_dataset.build(src, out, seed=1)
    make_dataset.report(summary)
    assert summary["images"] == {"train": 16, "val": 2, "test": 2}
    assert summary["skipped"]["unlabeled"] == 1
    by_split = {s: {p.parent.name for p in (out / "images" / s).rglob("*.jpg")} for s in SPLITS}
    assert by_split == {"train": {"sA"}, "val": {"sB"}, "test": {"sC"}} or by_split == {
        "train": {"sA"},
        "val": {"sC"},
        "test": {"sB"},
    }
    for img in (out / "images").rglob("*.jpg"):
        rel = img.relative_to(out / "images")
        assert (out / "labels" / rel).with_suffix(".txt").is_file()
    yaml = (out / "data.yaml").read_text()
    assert f'path: "{out.resolve()}"' in yaml and "  8: wire_end\n" in yaml and "val: images/val" in yaml

    reviewed_only = make_dataset.build(src, tmp_path / "v2", only_reviewed=True)
    assert sum(reviewed_only["images"].values()) == 3
    with pytest.raises(SystemExit):
        make_dataset.build(src, src)
