"""Dataset recording for the VLM fine-tuning (F7).

A recording session (hello.record = true, or `set_record`) writes to
<CV_DATA>/vlm/sessions/<session>/:
    hello.json        the design (rebuilds the expected state and the prompt)
    frames/<ms>.jpg   three frames per second, as received
    timeline.jsonl    {"t", "type": "frame"|"step"|"label", ...}

Labels come from the operator (keys in the overlay): error_inserted(kind) when an error was
made on purpose, error_fixed when undone, and the step advances ONLY when the operator says
the step is done — the model being trained never labels its own data.
training/vlm/build_dataset.py turns this into chat examples.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np


class Recorder:
    def __init__(self, root: Path, session_id: str, hello: dict[str, Any], every_s: float = 1 / 3) -> None:
        self.dir = root / "vlm" / "sessions" / f"{time.strftime('%Y%m%d-%H%M%S')}-{session_id}"
        (self.dir / "frames").mkdir(parents=True, exist_ok=True)
        (self.dir / "hello.json").write_text(json.dumps(hello, ensure_ascii=False))
        self._tl = (self.dir / "timeline.jsonl").open("a", encoding="utf-8")
        self.every_s = every_s
        self._last = 0.0
        self.frames = 0
        self.labels = 0

    def _write(self, rec: dict[str, Any]) -> None:
        rec.setdefault("t", time.time())
        self._tl.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._tl.flush()

    def frame(self, jpeg: bytes, step: int, H: np.ndarray | None, calibrated: bool, observed: list[dict]) -> bool:
        now = time.monotonic()
        if now - self._last < self.every_s:
            return False
        self._last = now
        name = f"{int(time.time() * 1000)}.jpg"
        (self.dir / "frames" / name).write_bytes(jpeg)
        self._write(
            {
                "type": "frame",
                "file": f"frames/{name}",
                "step": step,
                "H": None if H is None else [float(v) for v in H.flatten()],
                "calibrated": calibrated,
                "observed": observed,
            }
        )
        self.frames += 1
        return True

    def step(self, current: int, status: dict[str, str], source: str) -> None:
        self._write({"type": "step", "current": current, "status": status, "source": source})

    def label(self, kind: str, step: int, error: str | None = None, target: str | None = None) -> None:
        self._write({"type": "label", "kind": kind, "step": step, "error": error, "target": target})
        self.labels += 1

    def close(self) -> None:
        self._tl.close()
