"""How much each case's frame changes between `_a` and `_b` (a proxy for "can the VLM see it").

    cd server && uv run python ../sim/cockpit/diff_cases.py ../sim/cockpit/c172_takeoff

Counts pixels whose max channel difference exceeds 40/255 (the measure used on PR #36, where the VLM
missed every case under ~1.2k changed pixels and read master/flaps at ~5k+). Not a substitute for
`python -m app.perception.cases`: rotations change ~27k px and were still missed, for want of a cue.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

THRESHOLD = 40


def changed(a: Path, b: Path) -> int:
    x = np.asarray(Image.open(a).convert("RGB"), dtype=np.int16)
    y = np.asarray(Image.open(b).convert("RGB"), dtype=np.int16)
    return int((np.abs(x - y).max(axis=2) > THRESHOLD).sum())


def main() -> None:
    root = Path(sys.argv[1])
    spec = json.loads((root / "cases.json").read_text())
    print("| case | expected | changed px |")
    print("|---|---|---|")
    for case in spec["cases"]:
        n = changed(root / f"{case['name']}_a.jpg", root / f"{case['name']}_b.jpg")
        print(f"| {case['name']} | {case['expected'] or '—'} | {n} |")


if __name__ == "__main__":
    main()
