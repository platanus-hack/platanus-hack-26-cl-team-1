"""Learned controller training and evaluation (owner: Cote).

The server's code (`server/app`) is put on the path so the input encoding and the inference code are
defined once, in `server/app/controller/learned.py`, and used here as is.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TASKS_DIR = REPO_ROOT / "tasks"
WEIGHTS_DIR = REPO_ROOT / "training" / "controller" / "weights"
RESULTS_DIR = REPO_ROOT / "training" / "results"

if str(REPO_ROOT / "server") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "server"))
