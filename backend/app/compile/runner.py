"""Compile one sketch with arduino-cli and build the CompileResult (camelCase, see frontend/src/contracts/sim.ts)."""
from __future__ import annotations

import shutil
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..settings import settings
from . import jobs
from .boards import BoardToolchain, get_toolchain
from .cli import CliRun, ensure_libraries, parse_json, run_cli
from .parsing import (
    SKETCH_NAME,
    clean_log,
    explain_missing_libraries,
    parse_diagnostics,
    parse_json_diagnostics,
    parse_sizes,
)
from .sanitize import unsafe_sketch_reason

try:  # POSIX only; on other platforms every compile uses its private build path.
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

#: Reusable build paths per board (arduino-cli keeps core.a + objects there → fast recompiles).
CACHE_SLOTS = 2


def artifact_url(job_id: str) -> str:
    return f"/api/compile/{job_id}/artifact"


def base_result(job_id: str, board: str, fqbn: str, status: str, log: str = "") -> dict[str, Any]:
    return {"jobId": job_id, "status": status, "board": board, "fqbn": fqbn, "diagnostics": [], "log": log}


@contextmanager
def build_slot(board: str, fallback: Path) -> Iterator[Path]:
    """Lock a shared per-board build path; use `fallback` (job-private) when all slots are busy."""
    if fcntl is not None:
        base = jobs.build_root() / "cache" / board
        for i in range(CACHE_SLOTS):
            slot = base / f"slot-{i}"
            slot.mkdir(parents=True, exist_ok=True)
            fh = open(slot / ".lock", "w")  # noqa: SIM115 — closed in finally
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                fh.close()
                continue
            try:
                yield slot / "build"
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
                fh.close()
            return
    yield fallback


def find_artifact(out_dir: Path, tc: BoardToolchain) -> Path | None:
    preferred = out_dir / f"sketch{tc.artifact_suffix}"
    if preferred.is_file():
        return preferred
    if tc.fallback_suffix:
        alt = out_dir / f"sketch{tc.fallback_suffix}"
        if alt.is_file():
            return alt
    return None


def _includes_any(code: str, headers: list[str]) -> bool:
    return any(f"<{h}>" in code or f'"{h}"' in code for h in headers)


def _compile_once(tc: BoardToolchain, sketch_dir: Path, out_dir: Path, private_build: Path) -> tuple[CliRun, Path]:
    with build_slot(tc.id, private_build) as build_path:
        args = [
            "compile",
            "--fqbn", tc.fqbn,
            "--build-path", str(build_path),
            "--output-dir", str(out_dir),
            "--warnings", "default",
            "--json",
            str(sketch_dir),
        ]
        return run_cli(args, timeout_s=settings.compile_timeout_s), build_path


def run_compile(job_id: str, board: str, code: str) -> dict[str, Any]:
    """Synchronous compile (Celery task body / eager mode). Persists and returns the CompileResult."""
    started = time.monotonic()
    tc = get_toolchain(board)
    jd = jobs.job_dir(job_id)
    sketch_dir, out_dir = jd / "sketch", jd / "out"
    jd.mkdir(parents=True, exist_ok=True)
    if jobs.read_meta(job_id) is None:
        jobs.write_meta(job_id, board, tc.fqbn)
    jobs.mark_running(job_id)
    unsafe = unsafe_sketch_reason(code)  # the API rejects these too; never hand them to gcc
    if unsafe:
        result = base_result(job_id, tc.id, tc.fqbn, "error", unsafe)
        result["durationMs"] = int((time.monotonic() - started) * 1000)
        jobs.write_result(job_id, result)
        return result
    sketch_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    (sketch_dir / SKETCH_NAME).write_text(code, encoding="utf-8")

    lib_headers = [tc.library_headers.get(n, f"{n}.h") for n in tc.libraries]
    if _includes_any(code, lib_headers):
        ensure_libraries(tc.libraries)

    run, build_path = _compile_once(tc, sketch_dir, out_dir, jd / "build")
    result = _build_result(job_id, tc, run, jd, build_path, out_dir)
    missing_lib = any("Falta la biblioteca" in d["message"] for d in result["diagnostics"])
    if missing_lib and ensure_libraries(tc.libraries, force=True):
        run, build_path = _compile_once(tc, sketch_dir, out_dir, jd / "build")
        result = _build_result(job_id, tc, run, jd, build_path, out_dir)

    # A job-private build path (both cache slots were busy) is tens of MB for the ESP32 and is
    # never reused: drop it now instead of keeping it for the whole job TTL.
    shutil.rmtree(jd / "build", ignore_errors=True)
    result["durationMs"] = int((time.monotonic() - started) * 1000)
    jobs.write_result(job_id, result)
    return result


def _build_result(job_id: str, tc: BoardToolchain, run: CliRun, jd: Path, build_path: Path, out_dir: Path) -> dict[str, Any]:
    result = base_result(job_id, tc.id, tc.fqbn, "error")
    if run.missing_cli:
        result["log"] = (
            "No se encontró arduino-cli en el servidor de compilación. "
            "Instálalo o configura la variable ARDUINO_CLI."
        )
        return result

    data = parse_json(run.stdout) or {}
    compiler_out = str(data.get("compiler_out") or "")
    compiler_err = str(data.get("compiler_err") or "")
    if not data:  # not JSON (very old CLI or crash): use the raw streams
        compiler_out, compiler_err = run.stdout, run.stderr
    builder = data.get("builder_result") or {}

    diags = parse_json_diagnostics(builder.get("diagnostics")) or parse_diagnostics(compiler_err)
    diags = explain_missing_libraries(diags, tc.library_headers)

    parts: list[str] = []
    if run.timed_out:
        parts.append(f"La compilación superó el tiempo límite de {settings.compile_timeout_s} s y se detuvo.")
    error_msg = str(data.get("error") or "").strip()
    if error_msg and not diags:
        parts.append(_friendly_cli_error(error_msg, tc))
    if compiler_out.strip():
        parts.append(compiler_out)
    if compiler_err.strip():
        parts.append(compiler_err)
    if not data and run.stderr.strip() and run.stderr not in parts:
        parts.append(run.stderr)

    prefixes = []
    for p in (jd / "sketch", jd, build_path, out_dir):
        prefixes += [str(p), str(p.resolve())]
    result["log"] = clean_log("\n".join(parts), prefixes)
    result["diagnostics"] = diags

    success = bool(data.get("success")) if data else run.returncode == 0
    if run.timed_out or not success:
        return result

    artifact = find_artifact(out_dir, tc)
    if artifact is None:
        result["log"] = (result["log"] + "\n\nLa compilación terminó pero no se encontró el binario para cargar.").strip()
        return result

    result["status"] = "success"
    sizes = parse_sizes(builder, compiler_out)
    if sizes:
        result["sizes"] = sizes
    result["artifactUrl"] = artifact_url(job_id)
    result["artifactName"] = artifact.name
    return result


def _friendly_cli_error(message: str, tc: BoardToolchain) -> str:
    lower = message.lower()
    if "platform" in lower and ("not found" in lower or "not installed" in lower):
        return (
            f"El núcleo {tc.core} no está instalado en el servidor de compilación "
            f"(arduino-cli core install {tc.core}). Detalle: {message}"
        )
    return f"Error de arduino-cli: {message}"
