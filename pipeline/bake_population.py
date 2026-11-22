"""Bake where people are, for all of Chile and for the simulation grid (method: steps/population.py).

    cd pipeline && uv run python bake_population.py              # national product + the grid's two layers
    cd pipeline && uv run python bake_population.py --domain-only  # only the grid's layers, from the committed
                                                                   # national product (what bake.py runs)

Writes web/public/data/national/population_cl.{json,bin} and web/public/data/population_{home,work}.bin, and
refreshes grid.json (its "sources" list). Downloads (~80 MB) are cached in pipeline/.cache/population/.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from bake import SOURCES, step, validate_outputs
from steps import grid, population


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--domain-only", action="store_true", help="skip the national bake, read the committed product")
    args = ap.parse_args()
    grid.CACHE_DIR.mkdir(exist_ok=True)
    t0 = time.time()
    summary: dict[str, object] = {}
    if not args.domain_only:
        summary["national"] = step("population (national, 30 arc-seconds)", population.bake_national)
    (grid.OUT_DIR / "grid.json").write_text(json.dumps(grid.grid_meta(SOURCES), indent=1, ensure_ascii=False))
    summary["domain"] = step("population (simulation grid)", population.bake_domain)
    step("validate outputs against types.ts", validate_outputs)
    for k, v in summary.items():
        print(f"{k}: {json.dumps(v, ensure_ascii=False, indent=1)}")
    print(f"total time {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
