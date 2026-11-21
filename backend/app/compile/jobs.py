"""Job directories and persisted results (shared by the API and the worker through settings.build_dir).

Layout:  <build_dir>/<job_id>/
            meta.json      {board, fqbn, createdAt, mode}     (written by POST; mode 'celery' | 'inline')
            status.json    {status: 'running', startedAt}     (written by the task when it starts)
            result.json    CompileResult (camelCase)          (written by the task when it ends)
            sketch/sketch.ino, out/<artifacts>, build/ (private build path when no cache slot is free)
         <build_dir>/cache/<board>/slot-N/   reusable build paths (locked while in use)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from ..settings import settings

JOB_TTL_S = 3600
_CLEANUP_EVERY_S = 300
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_last_cleanup = 0.0


def new_job_id() -> str:
    return str(uuid.uuid4())


def is_valid_job_id(job_id: str) -> bool:
    """Canonical lowercase UUID only — prevents path traversal through the job id."""
    return isinstance(job_id, str) and _UUID_RE.fullmatch(job_id) is not None


def build_root() -> Path:
    root = Path(settings.build_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def job_dir(job_id: str) -> Path:
    if not is_valid_job_id(job_id):
        raise ValueError("invalid job id")
    return build_root() / job_id


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_meta(job_id: str, board: str, fqbn: str, mode: str = "celery", created_at: float | None = None) -> None:
    """mode 'inline' = compiled inside the API process (no Celery worker involved)."""
    data = {"board": board, "fqbn": fqbn, "createdAt": time.time() if created_at is None else created_at, "mode": mode}
    _write_json(job_dir(job_id) / "meta.json", data)


def read_meta(job_id: str) -> dict[str, Any] | None:
    return _read_json(job_dir(job_id) / "meta.json")


def mark_running(job_id: str) -> None:
    _write_json(job_dir(job_id) / "status.json", {"status": "running", "startedAt": time.time()})


def read_status(job_id: str) -> dict[str, Any] | None:
    return _read_json(job_dir(job_id) / "status.json")


def write_result(job_id: str, result: dict[str, Any]) -> None:
    _write_json(job_dir(job_id) / "result.json", result)


def read_result(job_id: str) -> dict[str, Any] | None:
    return _read_json(job_dir(job_id) / "result.json")


def cleanup_old_jobs(max_age_s: int = JOB_TTL_S, force: bool = False) -> int:
    """Remove job dirs older than max_age_s (throttled unless force). Returns how many were removed."""
    global _last_cleanup
    now = time.time()
    if not force and now - _last_cleanup < _CLEANUP_EVERY_S:
        return 0
    _last_cleanup = now
    removed = 0
    try:
        entries = list(build_root().iterdir())
    except OSError:
        return 0
    for entry in entries:
        if not (entry.is_dir() and is_valid_job_id(entry.name)):
            continue
        try:
            if now - entry.stat().st_mtime > max_age_s:
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed
