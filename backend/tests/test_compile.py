"""Compile service: parsers (unit) + HTTP API with a real arduino-cli (integration, eager mode)."""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

# `uv run pytest` from backend/ does not put backend/ on sys.path (no pythonpath in pyproject yet).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient

from app.compile import jobs
from app.compile.boards import get_toolchain
from app.compile.parsing import (
    clean_log,
    explain_missing_libraries,
    parse_diagnostics,
    parse_json_diagnostics,
    parse_sizes,
    trim_log,
)
from app.compile.router import router
from app.settings import settings

# --------------------------------------------------------------------------- parsers

STDERR = """/tmp/builds/abc/sketch/sketch.ino: In function 'void setup()':
/tmp/builds/abc/sketch/sketch.ino:4:36: error: expected ';' before '}' token
 void setup() { pinMode(13, OUTPUT) }
                                    ^
/tmp/builds/abc/sketch/sketch.ino:7:23: warning: invalid conversion from 'const char*' to 'int' [-fpermissive]
/tmp/builds/abc/sketch/sketch.ino:7:28: error: 'digitalWrit' was not declared in this scope
/tmp/builds/abc/sketch/sketch.ino:7:28: note: suggested alternative: 'digitalWrite'
/Users/x/Arduino15/packages/arduino/hardware/avr/1.8.7/cores/arduino/Arduino.h:10:1: error: not the sketch
C:\\builds\\abc\\sketch\\sketch.ino:9: error: no column here
"""


def test_parse_diagnostics_maps_lines_columns_and_notes():
    diags = parse_diagnostics(STDERR)
    assert diags == [
        {"line": 4, "column": 36, "severity": "error", "message": "expected ';' before '}' token"},
        {"line": 7, "column": 23, "severity": "warning", "message": "invalid conversion from 'const char*' to 'int' [-fpermissive]"},
        {"line": 7, "column": 28, "severity": "error", "message": "'digitalWrit' was not declared in this scope (¿quisiste decir 'digitalWrite'?)"},
        {"line": 9, "severity": "error", "message": "no column here"},
    ]


def test_parse_diagnostics_fatal_error_and_dedupe():
    err = "sketch.ino:1:10: fatal error: Servo.h: No such file or directory\nsketch.ino:1:10: fatal error: Servo.h: No such file or directory\n"
    assert parse_diagnostics(err) == [{"line": 1, "column": 10, "severity": "error", "message": "Servo.h: No such file or directory"}]
    assert parse_diagnostics("") == []


def test_parse_json_diagnostics():
    items = [
        {"severity": "FATAL", "message": "Servo.h: No such file or directory\n #include <Servo.h>\n ^~~", "file": "/x/sketch/sketch.ino", "line": 1, "column": 10},
        {"severity": "ERROR", "message": "'digitalWrit' was not declared in this scope\n code", "file": "/x/sketch/sketch.ino", "line": 2, "column": 28,
         "notes": [{"message": "suggested alternative: 'digitalWrite'\n ..."}]},
        {"severity": "WARNING", "message": "unused variable 'x'", "file": "/x/sketch/sketch.ino", "line": 3},
        {"severity": "ERROR", "message": "in the core", "file": "/core/Arduino.h", "line": 5, "column": 1},
        {"severity": "NOTE", "message": "ignored", "file": "/x/sketch/sketch.ino", "line": 3},
    ]
    assert parse_json_diagnostics(items) == [
        {"line": 1, "column": 10, "severity": "error", "message": "Servo.h: No such file or directory"},
        {"line": 2, "column": 28, "severity": "error", "message": "'digitalWrit' was not declared in this scope (¿quisiste decir 'digitalWrite'?)"},
        {"line": 3, "severity": "warning", "message": "unused variable 'x'"},
    ]
    assert parse_json_diagnostics(None) == []


def test_explain_missing_libraries_in_spanish():
    diags = [{"line": 1, "column": 10, "severity": "error", "message": "Servo.h: No such file or directory"}]
    out = explain_missing_libraries(diags, {"Servo": "Servo.h"})
    assert out[0]["line"] == 1
    assert "Falta la biblioteca «Servo»" in out[0]["message"]
    other = explain_missing_libraries([{"line": 2, "severity": "error", "message": "Foo.h: No such file or directory"}], {})
    assert "Foo.h" in other[0]["message"] and "no está instalada" in other[0]["message"]


def test_parse_sizes_from_builder_result_and_text():
    builder = {"executable_sections_size": [{"name": "text", "size": 924, "max_size": 32256}, {"name": "data", "size": 9, "max_size": 2048}]}
    assert parse_sizes(builder) == {"flashBytes": 924, "flashMax": 32256, "ramBytes": 9, "ramMax": 2048}
    text = (
        "Sketch uses 258122 bytes (19%) of program storage space. Maximum is 1310720 bytes.\n"
        "Global variables use 14840 bytes (4%) of dynamic memory, leaving 312840 bytes for local variables. Maximum is 327680 bytes.\n"
    )
    assert parse_sizes({}, text) == {"flashBytes": 258122, "flashMax": 1310720, "ramBytes": 14840, "ramMax": 327680}
    assert parse_sizes(None, "nothing here") is None


def test_clean_log_strips_server_paths_and_trims():
    log = "/srv/b/123/sketch/sketch.ino:3:1: error: boom\n"
    assert clean_log(log, ["/srv/b/123/sketch", "/srv/b/123"]) == "sketch.ino:3:1: error: boom"
    big = "x" * 50_000
    trimmed = trim_log(big)
    assert len(trimmed.encode()) <= 20 * 1024 + 64
    assert "omitidos" in trimmed


def test_toolchain_comes_from_board_profiles():
    uno, esp = get_toolchain("uno"), get_toolchain("esp32c6")
    assert uno.fqbn == "arduino:avr:uno" and uno.artifact_suffix == ".ino.hex" and "Servo" in uno.libraries
    assert esp.fqbn.startswith("esp32:esp32:esp32c6") and esp.artifact_suffix == ".ino.merged.bin"
    assert esp.download_name("sketch.ino.merged.bin") == "circuito-vivo-esp32c6.bin"
    assert esp.download_name("sketch.ino.bin") == "circuito-vivo-esp32c6-app-0x10000.bin"
    assert uno.download_name("sketch.ino.hex") == "circuito-vivo-uno.hex"


def test_job_id_validation():
    assert jobs.is_valid_job_id(jobs.new_job_id())
    for bad in ("", "../etc/passwd", "ABCDEF00-0000-4000-8000-000000000000", "1234", "a" * 36):
        assert not jobs.is_valid_job_id(bad)
    with pytest.raises(ValueError):
        jobs.job_dir("../x")


# --------------------------------------------------------------------------- HTTP API


@pytest.fixture
def client(tmp_path_factory, monkeypatch):
    build = tmp_path_factory.getbasetemp() / "compile-builds"  # shared → per-board build cache reused across tests
    monkeypatch.setattr(settings, "build_dir", build)
    monkeypatch.setattr(settings, "compile_eager", True)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


def test_api_validates_input(client):
    assert client.post("/api/compile", json={"board": "mega", "code": "void setup(){}"}).status_code == 422
    assert client.post("/api/compile", json={"board": "uno", "code": "   "}).status_code == 422
    assert client.post("/api/compile", json={"board": "uno", "code": "x" * (100 * 1024 + 1)}).status_code == 413
    assert client.get("/api/compile/not-a-uuid").status_code == 400
    assert client.get("/api/compile/not-a-uuid/artifact").status_code == 400
    assert client.get(f"/api/compile/{jobs.new_job_id()}").status_code == 404
    assert client.get(f"/api/compile/{jobs.new_job_id()}/artifact").status_code == 404


def test_cleanup_removes_old_jobs(client):
    old = jobs.job_dir(jobs.new_job_id())
    old.mkdir(parents=True)
    past = time.time() - 7200
    os.utime(old, (past, past))
    fresh = jobs.job_dir(jobs.new_job_id())
    fresh.mkdir(parents=True)
    assert jobs.cleanup_old_jobs(force=True) >= 1
    assert not old.exists() and fresh.exists()


def _cli_available() -> bool:
    return bool(shutil.which(settings.arduino_cli)) or Path(settings.arduino_cli).is_file()


needs_cli = pytest.mark.skipif(not _cli_available(), reason="arduino-cli not installed")

BLINK = """void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
"""

BROKEN = """void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrit(13, HIGH);
  delay(500)
}
"""


def _compile(client: TestClient, board: str, code: str) -> dict:
    r = client.post("/api/compile", json={"board": board, "code": code})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "queued" and jobs.is_valid_job_id(body["jobId"])
    deadline = time.time() + settings.compile_timeout_s + 30
    while True:
        res = client.get(f"/api/compile/{body['jobId']}").json()
        if res["status"] in ("success", "error") or time.time() > deadline:
            return res
        time.sleep(0.2)


@needs_cli
def test_compile_blink_uno_and_download(client):
    res = _compile(client, "uno", BLINK)
    assert res["status"] == "success", res["log"]
    assert res["board"] == "uno" and res["fqbn"] == "arduino:avr:uno"
    assert res["diagnostics"] == []
    assert res["artifactName"] == "sketch.ino.hex"
    assert res["artifactUrl"] == f"/api/compile/{res['jobId']}/artifact"
    assert res["sizes"]["flashBytes"] > 0 and res["sizes"]["flashMax"] == 32256
    assert res["durationMs"] > 0
    assert str(settings.build_dir) not in res["log"]
    art = client.get(res["artifactUrl"])
    assert art.status_code == 200
    assert art.content.startswith(b":") and b":00000001FF" in art.content
    assert 'filename="circuito-vivo-uno.hex"' in art.headers["content-disposition"]


@needs_cli
def test_compile_errors_are_line_mapped(client):
    res = _compile(client, "uno", BROKEN)
    assert res["status"] == "error"
    assert "artifactUrl" not in res
    lines = {(d["line"], d["severity"]) for d in res["diagnostics"]}
    assert (6, "error") in lines  # digitalWrit
    assert any(d["line"] in (7, 8) and d["severity"] == "error" for d in res["diagnostics"])  # missing ';'
    assert any("digitalWrite" in d["message"] for d in res["diagnostics"])
    assert client.get(f"/api/compile/{res['jobId']}/artifact").status_code == 404


@needs_cli
@pytest.mark.skipif(not os.environ.get("RUN_SLOW"), reason="slow (~15-25 s): set RUN_SLOW=1")
def test_compile_blink_esp32c6(client):
    started = time.time()
    res = _compile(client, "esp32c6", BLINK.replace("13", "8"))
    print(f"esp32c6 compile took {time.time() - started:.1f}s (server durationMs={res.get('durationMs')})")
    assert res["status"] == "success", res["log"]
    assert res["artifactName"] == "sketch.ino.merged.bin"
    art = client.get(res["artifactUrl"])
    assert art.status_code == 200 and len(art.content) > 100_000
    assert 'filename="circuito-vivo-esp32c6.bin"' in art.headers["content-disposition"]
