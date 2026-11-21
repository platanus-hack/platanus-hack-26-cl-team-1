import importlib.util
import json
import sys
from pathlib import Path

import cv2

from tests.synth import frame_of_mat, jpeg
from vision.registration import Registration
from vision.vlm_prompt import parse_verdict

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures"


def load_builder():
    spec = importlib.util.spec_from_file_location("build_dataset", ROOT / "training/vlm/build_dataset.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["build_dataset"] = mod  # dataclasses resolve annotations through sys.modules
    spec.loader.exec_module(mod)
    return mod


def status(current: int, n: int = 10) -> dict:
    return {str(i): "done" if i < current else "active" if i == current else "pending" for i in range(1, n + 1)}


def make_session(root: Path) -> Path:
    d = root / "sessions" / "20261121-190000-abc"
    (d / "frames").mkdir(parents=True)
    (d / "hello.json").write_text((FIX / "blink-uno.json").read_text())
    img, _ = frame_of_mat()
    reg = Registration()
    reg.update(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    H = [float(v) for v in reg.H.flatten()]
    tl = [{"t": 0.0, "type": "step", "current": 1, "status": status(1), "source": "start"}]
    for t, cur in ((5.0, 2), (10.0, 3), (20.0, 4), (40.0, 5)):
        tl.append({"t": t, "type": "step", "current": cur, "status": status(cur), "source": "manual"})
    tl.append(
        {"t": 30.0, "type": "label", "kind": "error_inserted", "step": 4, "error": "led_reversed", "target": "led1"}
    )
    tl.append({"t": 36.0, "type": "label", "kind": "error_fixed", "step": 4, "error": None, "target": None})
    for t in range(1, 61):
        name = f"frames/{t}.jpg"
        (d / name).write_bytes(jpeg(img))
        tl.append({"t": float(t), "type": "frame", "file": name, "step": 0, "H": H, "calibrated": True, "observed": []})
    (d / "timeline.jsonl").write_text("\n".join(json.dumps(r) for r in sorted(tl, key=lambda r: r["t"])))
    return d


def test_labels_from_the_timeline(tmp_path):
    b = load_builder()
    d = make_session(tmp_path)
    hello, tl = b.load_session(d)
    exs = b.label_session(d, b.build_expected(hello), tl)
    errors = [e for e in exs if e.estado == "error"]
    assert [int(e.t) for e in errors] == [31, 32, 33, 34, 35]
    assert all(e.step == 4 and e.tipo == "led_reversed" for e in errors)
    oks = {int(e.t): e.step for e in exs if e.estado == "ok"}
    assert 30 not in oks and 36 not in oks  # blocked: too close to the error interval
    assert oks[25] == 3 and oks[45] == 4  # the latest visual step already done
    assert min(oks) == 20  # from the moment step 3 is marked done (steps 1-2 are not visual)


def test_build_writes_balanced_production_shaped_examples(tmp_path, monkeypatch):
    b = load_builder()
    make_session(tmp_path)
    out = tmp_path / "v1"
    monkeypatch.setattr(sys, "argv", ["x", "--sessions", str(tmp_path / "sessions"), "--out", str(out)])
    b.main()
    recs = [json.loads(x) for x in (out / "train.jsonl").read_text().splitlines()]
    assert sum(r["estado"] == "error" for r in recs) == 10  # 5 frames × (with / without suspicion)
    assert sum(r["estado"] == "ok" for r in recs) == 10
    for r in recs:
        assert all(Path(p).exists() for p in r["images"])
        v = parse_verdict(r["target"])
        assert v is not None and v.estado == r["estado"]
        if r["estado"] == "error":
            assert '"hueco": "e7"' in r["user"] and v.mensaje.startswith("Ojo, el LED rojo está al revés")
    assert (out / "test.jsonl").read_text() == ""  # one session only: nothing held out
