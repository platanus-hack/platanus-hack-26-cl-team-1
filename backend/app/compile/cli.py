"""Thin arduino-cli wrapper: command line, subprocess with a hard timeout, library installation."""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from ..settings import settings

log = logging.getLogger(__name__)

#: Do not retry a failed `lib install` (offline machine) more often than this.
_LIB_RETRY_S = 600


@dataclass
class CliRun:
    returncode: int | None  # None = killed by timeout
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool = False
    missing_cli: bool = False


#: Environment variables never passed to arduino-cli / gcc: a sketch can make the compiler read
#: /proc/self/environ (and print it in the log), so secrets must not be in the child's environment.
_SECRET_NAME_RE = re.compile(r"KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|^ANTHROPIC_|^AWS_|^REDIS_|^CELERY_", re.IGNORECASE)
_URL_WITH_CREDENTIALS_RE = re.compile(r"://[^/@\s]*:[^/@\s]*@")


def child_env(environ: dict[str, str] | None = None) -> dict[str, str]:
    """Copy of the environment without secrets (API keys, tokens, passwords, broker URLs)."""
    src = os.environ if environ is None else environ
    return {
        k: v
        for k, v in src.items()
        if not _SECRET_NAME_RE.search(k) and not _URL_WITH_CREDENTIALS_RE.search(v)
    }


def cli_available() -> bool:
    """arduino-cli can be started from this process (the API container has no toolchain)."""
    cli = settings.arduino_cli
    return bool(shutil.which(cli)) or (os.path.isfile(cli) and os.access(cli, os.X_OK))


def base_cmd() -> list[str]:
    cmd = [settings.arduino_cli]
    if settings.arduino_config_file:
        cmd += ["--config-file", settings.arduino_config_file]
    return cmd


def run_cli(args: list[str], timeout_s: float) -> CliRun:
    """Run arduino-cli in its own process group so a timeout also kills gcc/esptool children."""
    start = time.monotonic()
    try:
        proc = subprocess.Popen(
            base_cmd() + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            env=child_env(),
            text=True,
            encoding="utf-8",
            errors="replace",
            start_new_session=True,
        )
    except (FileNotFoundError, PermissionError) as exc:
        return CliRun(None, "", str(exc), time.monotonic() - start, missing_cli=True)
    try:
        out, err = proc.communicate(timeout=timeout_s)
        return CliRun(proc.returncode, out or "", err or "", time.monotonic() - start)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, AttributeError):
            proc.kill()
        out, err = proc.communicate()
        return CliRun(None, out or "", err or "", time.monotonic() - start, timed_out=True)


def parse_json(stdout: str) -> dict[str, Any] | None:
    try:
        data = json.loads(stdout)
    except ValueError:
        # Some versions print log lines before the JSON document.
        brace = stdout.find("{")
        if brace < 0:
            return None
        try:
            data = json.loads(stdout[brace:])
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


# --------------------------------------------------------------------------- libraries

_lib_lock = threading.Lock()
_installed: set[str] = set()
_failed_at: dict[str, float] = {}


def installed_libraries() -> set[str]:
    run = run_cli(["lib", "list", "--json"], timeout_s=60)
    data = parse_json(run.stdout) if run.returncode == 0 else None
    names: set[str] = set()
    for item in (data or {}).get("installed_libraries") or []:
        lib = item.get("library") or {}
        if lib.get("name"):
            names.add(str(lib["name"]))
    return names


def ensure_libraries(names: Iterable[str], force: bool = False) -> list[str]:
    """Install missing libraries (best effort, offline-safe). Returns the names installed by this call."""
    wanted = [n for n in dict.fromkeys(names) if n]
    if not wanted:
        return []
    with _lib_lock:
        if not force and all(n in _installed for n in wanted):
            return []
        _installed.update(installed_libraries())
        now = time.time()
        missing = [n for n in wanted if n not in _installed and (force or now - _failed_at.get(n, 0) > _LIB_RETRY_S)]
        if not missing:
            return []
        newly: list[str] = []
        index_updated = False
        for name in missing:
            ok = run_cli(["lib", "install", name], timeout_s=180).returncode == 0
            if not ok and not index_updated:
                index_updated = True
                run_cli(["lib", "update-index"], timeout_s=120)
                ok = run_cli(["lib", "install", name], timeout_s=180).returncode == 0
            if ok:
                newly.append(name)
                _installed.add(name)
            else:
                _failed_at[name] = now
                log.warning("arduino-cli: could not install library %s (offline?)", name)
        if newly:
            log.info("arduino-cli: installed libraries %s", ", ".join(newly))
        return newly
