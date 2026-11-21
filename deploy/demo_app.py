"""Demo entry point: the session server plus the built web app on one origin.

The public demo is a single process on the GPU box behind one Cloudflare tunnel (D-015): `/api/*` and
`/ws/session` come from `app.main`, everything else is the static Vite build in `SUP_WEB_DIST`. One
origin means no CORS, no `?server=` and no second host. Open sessions are capped (`session_cap.py`).
Run from `server/` (deploy/box/run-server.sh):

    SUP_WEB_DIST=../web/dist PYTHONPATH=. uv run uvicorn --app-dir ../deploy demo_app:app --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from session_cap import SessionCap

from app.main import create_app

dist = Path(os.environ.get("SUP_WEB_DIST", Path(__file__).resolve().parents[1] / "web" / "dist"))
if not (dist / "index.html").is_file():
    raise RuntimeError(f"no web build at {dist} (run `pnpm build` in web/, or set SUP_WEB_DIST)")

api = create_app()
# Mounted last, so the API and WebSocket routes above still win; html=True serves index.html at /.
api.mount("/", StaticFiles(directory=dist, html=True), name="web")
app = SessionCap(api, int(os.environ.get("SUP_DEMO_MAX_SESSIONS", "4")))
