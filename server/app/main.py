"""FastAPI app: task library API and the session WebSocket.

uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from contracts import Task, TaskSummary
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .controller.rules import RulesController
from .library.store import TaskLibrary
from .perception.factory import make_perception
from .session.ws import run_session
from .settings import Settings
from .voice.factory import make_voice
from .voice.queue import VoiceQueue


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    library = TaskLibrary.load(settings.tasks_dir)
    voice = make_voice(settings)

    app = FastAPI(title="Supervisor")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET"])

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "perception": settings.perception, "voice": settings.voice}

    @app.get("/api/tasks")
    def tasks() -> list[TaskSummary]:
        return library.summaries()

    @app.get("/api/tasks/{task_id}")
    def task(task_id: str) -> Task:
        found = library.get(task_id)
        if found is None:
            raise HTTPException(404, f"no task {task_id!r}")
        return found

    @app.websocket("/ws/session")
    async def session(ws: WebSocket) -> None:
        await run_session(
            ws,
            library,
            lambda t: make_perception(settings, t),
            RulesController,
            voice,
            lambda: VoiceQueue(min_gap_ms=settings.voice_min_gap_ms),
        )

    return app


app = create_app()
