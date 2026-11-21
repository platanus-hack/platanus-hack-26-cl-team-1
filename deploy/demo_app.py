"""Demo entry point: the session server plus the built web app on one origin.

The public demo is a single process on the GPU box behind one Cloudflare tunnel (D-015): `/api/*` and
`/ws/session` come from `app.main`, everything else is the static Vite build in `SUP_WEB_DIST`. One
origin means no CORS, no `?server=` and no second host. Run from `server/` (deploy/box/run-server.sh):

    SUP_WEB_DIST=../web/dist PYTHONPATH=. uv run uvicorn --app-dir ../deploy demo_app:app --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi.staticfiles import StaticFiles

from app.main import create_app

dist = Path(os.environ.get("SUP_WEB_DIST", Path(__file__).resolve().parents[1] / "web" / "dist"))
if not (dist / "index.html").is_file():
    raise RuntimeError(f"no web build at {dist} (run `pnpm build` in web/, or set SUP_WEB_DIST)")


class SessionCap:
    """At most `limit` open `/ws/session` connections. The link is public and unauthenticated, and every
    session drives its own VLM loop; without a cap, a few extra tabs queue vLLM until the judges' own
    sessions time out. Extra connections are accepted and closed at once with 1013 + a reason the UI shows."""

    REASON = "Demo ocupada: hay demasiadas sesiones abiertas. Intenta en un momento."

    def __init__(self, app: Any, limit: int) -> None:
        if limit < 1:
            raise ValueError(f"SUP_DEMO_MAX_SESSIONS must be >= 1, got {limit}")
        self.app, self.limit, self.open = app, limit, 0

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "websocket" or scope["path"] != "/ws/session":
            return await self.app(scope, receive, send)
        if self.open >= self.limit:  # one event loop: no lock needed
            await receive()  # websocket.connect
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.close", "code": 1013, "reason": self.REASON})
            return
        self.open += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.open -= 1


api = create_app()
# Mounted last, so the API and WebSocket routes above still win; html=True serves index.html at /.
api.mount("/", StaticFiles(directory=dist, html=True), name="web")
app = SessionCap(api, int(os.environ.get("SUP_DEMO_MAX_SESSIONS", "4")))
