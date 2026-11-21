"""A cap on open demo sessions (D-015). Kept apart from `demo_app` so it imports without a web build.

The public link has no login, and every session drives its own VLM loop. Without a cap, a few extra tabs queue
vLLM until the judges' own sessions time out. A connection takes a slot only once it sends its first message
(the hello), and it must send it within `hello_timeout_s`, so idle sockets can't hold slots. A connection over
the cap is closed with 1013 and a reason the web UI shows.
"""

from __future__ import annotations

import asyncio
from typing import Any

BUSY_REASON = "Demo ocupada: hay demasiadas sesiones abiertas. Intenta en un momento."
SLOW_REASON = "No llegó el saludo a tiempo; recarga la página."


class SessionCap:
    def __init__(
        self, app: Any, limit: int, hello_timeout_s: float = 10.0, path: str = "/ws/session"
    ) -> None:
        if limit < 1:
            raise ValueError(f"SUP_DEMO_MAX_SESSIONS must be >= 1, got {limit}")
        if hello_timeout_s <= 0:
            raise ValueError(f"hello timeout must be > 0, got {hello_timeout_s}")
        self.app, self.limit, self.hello_timeout_s, self.path = app, limit, hello_timeout_s, path
        self.open = 0  # one event loop: no lock needed

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "websocket" or scope["path"] != self.path:
            return await self.app(scope, receive, send)
        counted = False

        async def refuse(code: int, reason: str) -> dict:
            # The app already accepted (it reads the hello after accept): close, tell it the client left.
            await send({"type": "websocket.close", "code": code, "reason": reason})
            return {"type": "websocket.disconnect", "code": code}

        async def capped_receive() -> dict:
            nonlocal counted
            if counted:
                return await receive()
            try:
                message = await asyncio.wait_for(receive(), self.hello_timeout_s)
            except TimeoutError:
                return await refuse(1008, SLOW_REASON)
            if message["type"] == "websocket.receive":  # the first message: take a slot or refuse
                if self.open >= self.limit:
                    return await refuse(1013, BUSY_REASON)
                counted = True
                self.open += 1
            return message

        try:
            await self.app(scope, capped_receive, send)
        finally:
            if counted:
                self.open -= 1
