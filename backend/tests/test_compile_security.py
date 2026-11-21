"""Compile service: security + robustness regressions (sketch screening, secrets, worker-down status, cleanup)."""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import stat
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.compile import jobs, router as router_mod, runner  # noqa: E402
from app.compile.cli import child_env, run_cli  # noqa: E402
from app.compile.router import router  # noqa: E402
from app.compile.sanitize import unsafe_sketch_reason  # noqa: E402
from app.settings import settings  # noqa: E402

BLINK = "void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n}\n"


@pytest.fixture
def build_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "build_dir", tmp_path / "builds")
    return tmp_path / "builds"


@pytest.fixture
def api(build_dir, monkeypatch):
    """Celery mode (not eager) with the broker/worker probes stubbed out."""
    monkeypatch.setattr(settings, "compile_eager", False)
    monkeypatch.setattr(router_mod, "_celery_state", lambda job_id: None)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app, raise_server_exceptions=False)


def _fake_cli(tmp_path: Path, body: str) -> str:
    path = tmp_path / "fake-arduino-cli"
    path.write_text("#!/bin/sh\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(path)


# --------------------------------------------------------------------------- job ids / input


def test_job_id_with_trailing_newline_is_rejected():
    jid = jobs.new_job_id()
    assert jobs.is_valid_job_id(jid)
    assert not jobs.is_valid_job_id(jid + "\n")  # `$` used to accept it
    assert not jobs.is_valid_job_id(None)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        jobs.job_dir(jid + "\n")


def test_post_with_lone_surrogate_is_a_422_not_a_500(api):
    r = api.post(
        "/api/compile",
        content=b'{"board": "uno", "code": "void setup(){} // \\ud800"}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422
    assert "caracteres" in r.json()["detail"]


# --------------------------------------------------------------------------- sketch screening

UNSAFE = [
    '#include "/etc/passwd"\nvoid setup(){}\nvoid loop(){}\n',
    '#include "../../../.env"\n',
    "#include <../../../../backend/.env>\n",
    '  #  include   "/proc/self/environ"\n',
    '%:include "/etc/passwd"\n',  # digraph
    '??=include "/etc/passwd"\n',  # trigraph
    '#inc\\\nlude "/etc/passwd"\n',  # line splice
    '#include \\\n "/etc/passwd"\n',
    '#/**/include "/etc/passwd"\n',
    '#include /**/ "/etc/passwd"\n',
    '/*\n*/#include "/etc/passwd"\n',  # comment ending right before the directive
    '#/*\n*/include "/etc/passwd"\n',
    '#define F "/etc/passwd"\n#include F\n',  # computed include
    '#include_next "/etc/passwd"\n',
    '#import "/etc/passwd"\n',
    '#embed "/etc/passwd"\n',
    '\ufeff#include "/etc/passwd"\n',
    '#include "C:\\\\x.h"\n',
    '#pragma GCC dependency <a/*>\n#/**/include "/etc/passwd"\n// */\n',
    'Serial.print("/*");\n#include "/etc/passwd"\n// */\n',
    'auto s = R"x(\n)x";\n#include "/etc/passwd"\n',
    'void setup(){ asm(".incbin \\"/etc/passwd\\""); }\n',
    'void setup(){ __asm__ volatile("nop"); }\n',
    'void setup(){ __ASM("nop"); }\n',
    '#define CAT(a, b) a##b\nvoid setup(){ CAT(as, m)("nop"); }\n',
    '#define CAT(a, b) a%:%:b\n',
]

SAFE = [
    BLINK,
    "#include <Servo.h>\n" + BLINK,
    "#include <ESP32Servo.h>\n#include <avr/io.h>\n#include \"freertos/FreeRTOS.h\"\n" + BLINK,
    'void setup(){ Serial.println("#### Menú ## /* no es comentario */ fin"); Serial.println("usa #include \\"/etc/x\\""); }\n',
    "// comentario con /* y */ y #include \"/etc/passwd\" dentro de un comentario de línea\n" + BLINK,
    "int x = 1'000'000; char c = '#'; char d = '\\'';\n" + BLINK,
    'const char* fantasma = "fantasma";\n' + BLINK,
    "#define LED 13\n#if LED > 2\n#endif\n" + BLINK,
]


@pytest.mark.parametrize("code", UNSAFE)
def test_unsafe_sketches_are_rejected(code):
    assert unsafe_sketch_reason(code), code


@pytest.mark.parametrize("code", SAFE)
def test_generated_style_sketches_are_accepted(code):
    assert unsafe_sketch_reason(code) is None, code


def test_post_rejects_file_include_with_spanish_detail(api):
    r = api.post("/api/compile", json={"board": "uno", "code": '#include "/etc/passwd"\n' + BLINK})
    assert r.status_code == 422
    assert "no permitido" in r.json()["detail"]


def test_runner_never_hands_a_file_include_to_gcc(build_dir, tmp_path):
    """Before: gcc printed the included file (here a fake secret) in the compile log."""
    secret = tmp_path / "secret.txt"
    secret.write_text("TOPSECRET_TOKEN_abc123 = 1\n")
    jid = jobs.new_job_id()
    res = runner.run_compile(jid, "uno", f'#include "{secret}"\n' + BLINK)
    assert res["status"] == "error"
    assert "TOPSECRET_TOKEN_abc123" not in res["log"]
    assert "no permitido" in res["log"]
    assert jobs.read_result(jid)["status"] == "error"


# --------------------------------------------------------------------------- subprocess


def test_compiler_environment_has_no_secrets(monkeypatch):
    env_bin = shutil.which("env")
    assert env_bin
    monkeypatch.setattr(settings, "arduino_cli", env_bin)
    monkeypatch.setattr(settings, "arduino_config_file", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-123")
    monkeypatch.setenv("MY_SERVICE_TOKEN", "tok-456")
    monkeypatch.setenv("REDIS_URL", "redis://:hunter2@redis:6379/0")
    monkeypatch.setenv("SOME_URL", "https://user:pw789@example.test/x")
    run = run_cli([], timeout_s=10)
    assert run.returncode == 0
    for leaked in ("sk-ant-test-123", "tok-456", "hunter2", "pw789"):
        assert leaked not in run.stdout
    assert "PATH=" in run.stdout and "HOME=" in run.stdout
    assert child_env({"ARDUINO_DIRECTORIES_DATA": "/x", "OPENAI_API_KEY": "k"}) == {"ARDUINO_DIRECTORIES_DATA": "/x"}


def test_timeout_kills_the_whole_process_group(tmp_path, monkeypatch):
    pidfile = tmp_path / "child.pid"
    cli = _fake_cli(tmp_path, f'sleep 30 &\necho $! > "{pidfile}"\nwait\n')
    monkeypatch.setattr(settings, "arduino_cli", cli)
    monkeypatch.setattr(settings, "arduino_config_file", "")
    started = time.monotonic()
    run = run_cli(["compile"], timeout_s=1)
    assert run.timed_out and run.returncode is None
    assert time.monotonic() - started < 10  # communicate() after the kill does not hang
    pid = int(pidfile.read_text())
    deadline = time.monotonic() + 3
    alive = True
    while alive and time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
            time.sleep(0.05)
        except ProcessLookupError:
            alive = False
    assert not alive, "grandchild (gcc/esptool) survived the timeout"


# --------------------------------------------------------------------------- build paths

FAKE_COMPILE = """B=""; O=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build-path) B="$2"; shift;;
    --output-dir) O="$2"; shift;;
  esac
  shift
done
mkdir -p "$B" "$O"
head -c 200000 /dev/zero > "$B/core.a"
printf ':00000001FF\\n' > "$O/sketch.ino.hex"
echo '{"success": true, "compiler_out": "", "compiler_err": "", "builder_result": {"executable_sections_size": [{"name": "text", "size": 10, "max_size": 32256}]}}'
"""


def test_concurrent_compiles_of_one_board_never_share_a_build_path(build_dir, tmp_path):
    with contextlib.ExitStack() as stack:
        paths = [stack.enter_context(runner.build_slot("uno", tmp_path / f"private-{i}")) for i in range(runner.CACHE_SLOTS + 1)]
    assert len(set(paths)) == len(paths)
    assert paths[-1] == tmp_path / f"private-{runner.CACHE_SLOTS}"  # all slots busy → job-private path


def test_private_build_path_is_removed_after_the_compile(build_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "arduino_cli", _fake_cli(tmp_path, FAKE_COMPILE))
    monkeypatch.setattr(settings, "arduino_config_file", "")
    jid = jobs.new_job_id()
    with contextlib.ExitStack() as stack:
        for i in range(runner.CACHE_SLOTS):  # every cache slot busy
            stack.enter_context(runner.build_slot("uno", tmp_path / f"held-{i}"))
        res = runner.run_compile(jid, "uno", BLINK)
    assert res["status"] == "success", res["log"]
    assert res["artifactName"] == "sketch.ino.hex"
    assert (jobs.job_dir(jid) / "out" / "sketch.ino.hex").is_file()
    assert not (jobs.job_dir(jid) / "build").exists()


# --------------------------------------------------------------------------- worker down / status mapping


def _write_meta(jid: str, created_at: float, mode: str | None = None) -> None:
    jd = jobs.job_dir(jid)
    jd.mkdir(parents=True, exist_ok=True)
    meta = {"board": "uno", "fqbn": "arduino:avr:uno", "createdAt": created_at}
    if mode:
        meta["mode"] = mode
    (jd / "meta.json").write_text(json.dumps(meta))


def test_running_job_that_waited_long_in_the_queue_is_not_reported_stale(api, monkeypatch):
    """Before: staleness was measured from the POST, so a busy classroom queue turned running jobs into errors."""
    monkeypatch.setattr(router_mod, "workers_available", lambda: True)
    jid = jobs.new_job_id()
    _write_meta(jid, time.time() - (settings.compile_timeout_s + 400))
    jobs.mark_running(jid)
    assert api.get(f"/api/compile/{jid}").json()["status"] == "running"


def test_running_job_past_the_hard_limit_is_reported_lost(api, monkeypatch):
    monkeypatch.setattr(router_mod, "workers_available", lambda: True)
    jid = jobs.new_job_id()
    _write_meta(jid, time.time() - 5000)
    (jobs.job_dir(jid) / "status.json").write_text(json.dumps({"status": "running", "startedAt": time.time() - 4000}))
    body = api.get(f"/api/compile/{jid}").json()
    assert body["status"] == "error" and "Vuelve a compilar" in body["log"]


def test_queued_job_with_no_worker_alive_fails_fast(api, monkeypatch):
    """Before: a worker that died after the POST left the student staring at 'En cola' for 8 minutes."""
    monkeypatch.setattr(router_mod, "workers_available", lambda: False)
    jid = jobs.new_job_id()
    _write_meta(jid, time.time() - 60)
    body = api.get(f"/api/compile/{jid}").json()
    assert body["status"] == "error"
    assert "worker" in body["log"]


def test_queued_job_with_a_busy_worker_keeps_waiting(api, monkeypatch):
    monkeypatch.setattr(router_mod, "workers_available", lambda: True)
    jid = jobs.new_job_id()
    _write_meta(jid, time.time() - 60)
    body = api.get(f"/api/compile/{jid}").json()
    assert body["status"] == "queued" and "Esperando" in body["log"]


def test_inline_job_is_not_reported_as_missing_worker(api, monkeypatch):
    monkeypatch.setattr(router_mod, "workers_available", lambda: False)
    jid = jobs.new_job_id()
    _write_meta(jid, time.time() - 60, mode="inline")
    assert api.get(f"/api/compile/{jid}").json()["status"] == "queued"


def test_post_without_local_cli_enqueues_even_if_the_ping_failed(api, monkeypatch):
    """Docker: the API image has no arduino-cli, so compiling in-process only produced 'No se encontró arduino-cli'."""
    sent: list[str] = []
    monkeypatch.setattr(settings, "arduino_cli", "/nonexistent/arduino-cli")
    monkeypatch.setattr(router_mod, "workers_available", lambda: False)
    monkeypatch.setattr(router_mod, "broker_reachable", lambda: True)
    monkeypatch.setattr(router_mod.compile_sketch, "apply_async", lambda args, task_id, retry: sent.append(task_id))
    r = api.post("/api/compile", json={"board": "uno", "code": BLINK})
    assert r.status_code == 202
    jid = r.json()["jobId"]
    assert sent == [jid]
    assert api.get(f"/api/compile/{jid}").json()["status"] == "queued"


def test_post_without_broker_and_without_cli_reports_service_down(api, monkeypatch):
    monkeypatch.setattr(settings, "arduino_cli", "/nonexistent/arduino-cli")
    monkeypatch.setattr(router_mod, "workers_available", lambda: False)
    monkeypatch.setattr(router_mod, "broker_reachable", lambda: False)
    r = api.post("/api/compile", json={"board": "uno", "code": BLINK})
    assert r.status_code == 202
    body = api.get(f"/api/compile/{r.json()['jobId']}").json()
    assert body["status"] == "error"
    assert "no está disponible" in body["log"]
