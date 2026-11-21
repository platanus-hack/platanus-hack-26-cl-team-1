"""Compile API.

POST /api/compile {board, code}       -> 202 {jobId, status: 'queued'}
GET  /api/compile/{job_id}            -> CompileResult (see frontend/src/contracts/sim.ts)
GET  /api/compile/{job_id}/artifact   -> binary download (.hex for Uno, merged .bin for ESP32-C6)
"""
from __future__ import annotations

import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from ..settings import settings
from . import artifacts, jobs
from .broker import broker_reachable, workers_available
from .boards import get_toolchain
from .celery_app import celery_app
from .cli import cli_available
from .runner import base_result
from .sanitize import unsafe_sketch_reason
from .tasks import compile_job, compile_sketch

log = logging.getLogger(__name__)
router = APIRouter(tags=["compile"])

MAX_CODE_BYTES = 100 * 1024
#: Still QUEUED (never started) this long after the POST → reported as failed.
_STALE_MARGIN_S = 300
#: Queued for longer than this → tell the user we are waiting for a worker.
_QUEUED_HINT_S = 20
#: Queued this long while no Celery worker answers a ping → the worker died after the POST.
_NO_WORKER_S = 45
#: Extra time on top of the Celery hard time limit before a RUNNING job is declared lost.
_RUN_MARGIN_S = 60

MSG_NO_WORKER = (
    "No hay ningún worker de compilación activo, así que esta compilación no va a empezar. "
    "Vuelve a compilar en un momento; si sigue fallando, avisa a quien administra el servidor."
)
MSG_SERVICE_DOWN = (
    "El servicio de compilación no está disponible (no hay un worker de compilación conectado). "
    "Vuelve a intentarlo en un momento o avisa a quien administra el servidor."
)


class CompileRequest(BaseModel):
    board: Literal["uno", "esp32c6"]
    code: str = Field(..., description="Arduino sketch, compiled verbatim as sketch/sketch.ino")


def _check_job_id(job_id: str) -> None:
    if not jobs.is_valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Identificador de compilación inválido.")


@router.post("/compile", status_code=202)
def start_compile(req: CompileRequest, background: BackgroundTasks) -> dict[str, Any]:
    try:
        size = len(req.code.encode("utf-8"))
    except UnicodeEncodeError:  # lone surrogates ("\ud800") are valid JSON but not UTF-8
        raise HTTPException(status_code=422, detail="El programa contiene caracteres inválidos (texto Unicode mal formado).") from None
    if size > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"El programa es demasiado grande ({size} bytes; máximo {MAX_CODE_BYTES}).")
    if not req.code.strip():
        raise HTTPException(status_code=422, detail="El programa está vacío.")
    unsafe = unsafe_sketch_reason(req.code)
    if unsafe:
        raise HTTPException(status_code=422, detail=unsafe)

    jobs.cleanup_old_jobs()
    tc = get_toolchain(req.board)
    job_id = jobs.new_job_id()
    jobs.job_dir(job_id).mkdir(parents=True, exist_ok=True)

    if settings.compile_eager:
        jobs.write_meta(job_id, req.board, tc.fqbn, mode="inline")
        background.add_task(compile_job, job_id, req.board, req.code)
        return {"jobId": job_id, "status": "queued"}

    jobs.write_meta(job_id, req.board, tc.fqbn, mode="celery")
    local_cli = cli_available()
    # Without a local arduino-cli (the docker API image) compiling in-process can only fail, so a
    # worker that did not answer the ping in time (busy, restarting) still gets the job.
    if workers_available() or (not local_cli and broker_reachable()):
        try:
            compile_sketch.apply_async(args=[req.board, req.code], task_id=job_id, retry=False)
            return {"jobId": job_id, "status": "queued"}
        except Exception as exc:  # noqa: BLE001
            log.warning("Celery apply_async failed (%s)", exc)
    if local_cli:  # no broker / no worker: compile in-process so local dev still works
        log.warning("No Celery worker available, compiling %s in-process", job_id)
        jobs.write_meta(job_id, req.board, tc.fqbn, mode="inline")
        background.add_task(compile_job, job_id, req.board, req.code)
    else:
        jobs.write_result(job_id, base_result(job_id, req.board, tc.fqbn, "error", MSG_SERVICE_DOWN))
    return {"jobId": job_id, "status": "queued"}


def _celery_state(job_id: str) -> tuple[str, Any] | None:
    if not broker_reachable():
        return None
    try:
        res = compile_sketch.AsyncResult(job_id)
        return res.state, (res.result if res.state in ("SUCCESS", "FAILURE") else None)
    except Exception:  # noqa: BLE001 — Redis down
        return None


def _num(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _run_budget_s() -> float:
    """How long a started job may run: the Celery hard time limit (covers library installs) + margin."""
    limit = celery_app.conf.task_time_limit or (settings.compile_timeout_s + 240)
    return float(limit) + _RUN_MARGIN_S


@router.get("/compile/{job_id}")
def get_compile(job_id: str) -> dict[str, Any]:
    _check_job_id(job_id)
    if not jobs.job_dir(job_id).is_dir():
        raise HTTPException(status_code=404, detail="Compilación no encontrada (puede haber expirado).")

    done = jobs.read_result(job_id)
    if done:
        return done

    meta = jobs.read_meta(job_id) or {}
    board, fqbn = str(meta.get("board", "")), str(meta.get("fqbn", ""))
    now = time.time()
    created = _num(meta.get("createdAt"), now)
    inline = settings.compile_eager or meta.get("mode") == "inline"

    state: tuple[str, Any] | None = None if inline else _celery_state(job_id)
    if state and state[0] == "SUCCESS" and isinstance(state[1], dict):
        return state[1]  # worker without a shared build volume
    if state and state[0] == "FAILURE":
        return base_result(job_id, board, fqbn, "error", f"La compilación falló en el servidor: {state[1]}")

    status = jobs.read_status(job_id)
    if status is not None or (state is not None and state[0] == "STARTED"):
        # Measured from when it STARTED: a job that waited long in a busy queue is not stale.
        started = _num((status or {}).get("startedAt"), created)
        if now - started > _run_budget_s():
            return base_result(
                job_id, board, fqbn, "error",
                "La compilación se interrumpió en el servidor y no terminó. Vuelve a compilar.",
            )
        return base_result(job_id, board, fqbn, "running")

    age = now - created
    if age > settings.compile_timeout_s + _STALE_MARGIN_S:
        return base_result(
            job_id, board, fqbn, "error",
            "La compilación no empezó a tiempo. ¿Está corriendo el worker de compilación (Celery)?",
        )
    if not inline and age > _NO_WORKER_S and not workers_available():
        return base_result(job_id, board, fqbn, "error", MSG_NO_WORKER)
    hint = "Esperando un worker de compilación libre…" if age > _QUEUED_HINT_S else ""
    return base_result(job_id, board, fqbn, "queued", hint)


@router.get("/compile/{job_id}/artifact")
def get_artifact(job_id: str) -> Response:
    _check_job_id(job_id)
    result = jobs.read_result(job_id)
    if result is None:  # worker without a shared build volume: the result lives in Celery/Redis
        state = _celery_state(job_id)
        if state and state[0] == "SUCCESS" and isinstance(state[1], dict):
            result = state[1]
    if not result or result.get("status") != "success" or not result.get("artifactName"):
        raise HTTPException(status_code=404, detail="No hay un binario disponible para esta compilación.")
    jd = jobs.job_dir(job_id).resolve()
    path = (jd / "out" / str(result["artifactName"])).resolve()
    if jd not in path.parents:
        raise HTTPException(status_code=404, detail="No hay un binario disponible para esta compilación.")
    tc = get_toolchain(str(result.get("board")))
    filename = tc.download_name(path.name)
    headers = {"Cache-Control": "no-store", "X-Artifact-Name": path.name}
    if path.is_file():
        return FileResponse(path, media_type="application/octet-stream", filename=filename, headers=headers)
    data = artifacts.fetch(job_id)
    if data is None:
        raise HTTPException(status_code=404, detail="El binario ya no está disponible (expiró). Vuelve a compilar.")
    headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return Response(content=data, media_type="application/octet-stream", headers=headers)
