"""Celery task that runs arduino-cli (also callable inline when settings.compile_eager)."""
from __future__ import annotations

import logging
from typing import Any

from . import artifacts, jobs
from .boards import BOARD_IDS, get_toolchain
from .celery_app import celery_app
from .runner import base_result, run_compile

log = logging.getLogger(__name__)


def compile_job(job_id: str, board: str, code: str) -> dict[str, Any]:
    """Run one compile job and ALWAYS persist a CompileResult (never raises)."""
    try:
        return run_compile(job_id, board, code)
    except Exception as exc:  # noqa: BLE001 — surface any crash as a compile error
        log.exception("compile job %s crashed", job_id)
        fqbn = get_toolchain(board).fqbn if board in BOARD_IDS else ""
        result = base_result(job_id, board, fqbn, "error", f"Error interno del compilador: {exc}")
        try:
            jobs.write_result(job_id, result)
        except Exception:  # noqa: BLE001
            log.exception("could not persist result of %s", job_id)
        return result


@celery_app.task(name="compile_sketch", bind=True)
def compile_sketch(self, board: str, code: str) -> dict:
    """Celery entry point. The job id is the Celery task id (POST uses apply_async(task_id=jobId))."""
    job_id = self.request.id or jobs.new_job_id()
    result = compile_job(job_id, board, code)
    name = result.get("artifactName")
    if result.get("status") == "success" and name and not self.request.is_eager:
        # The API may not share our disk (Render): hand the binary over through Redis too.
        artifacts.publish(job_id, jobs.job_dir(job_id) / "out" / str(name))
    return result
