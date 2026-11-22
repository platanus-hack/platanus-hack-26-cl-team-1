"""Bake every fire company of Chile with its trucks (method: steps/bomberos.py).

    cd pipeline && uv run python bake_bomberos.py

Writes web/public/data/national/bomberos_cl.json from the JNB cuartel survey 2025, the bomberos.cl compañía list,
OpenStreetMap, geoBoundaries, the committed national population product and the curated
pipeline/bomberos/fleets.json. Downloads (~20 MB) are cached in pipeline/.cache/bomberos/.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import time
from zoneinfo import ZoneInfo

from steps import bomberos


def main() -> int:
    t0 = time.time()
    baked = dt.datetime.now(ZoneInfo("America/Santiago")).date().isoformat()
    summary = bomberos.bake(baked)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print(f"wrote {bomberos.OUT_FILE} in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
