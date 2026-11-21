"""Artifact download when the worker does not share the API's build volume (Render)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.compile import artifacts, jobs
from app.compile import router as compile_router
from app.main import health
from app.settings import settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "build_dir", tmp_path / "builds")
    app = FastAPI()
    app.include_router(compile_router.router, prefix="/api")
    return TestClient(app)


def _remote_success(job_id: str) -> dict:
    return {"jobId": job_id, "status": "success", "board": "uno", "fqbn": "arduino:avr:uno", "artifactName": "sketch.ino.hex"}


def test_artifact_served_from_redis_when_not_on_local_disk(client, monkeypatch):
    job_id = jobs.new_job_id()
    jobs.job_dir(job_id).mkdir(parents=True)  # the API created it on POST; the worker wrote elsewhere
    monkeypatch.setattr(compile_router, "_celery_state", lambda jid: ("SUCCESS", _remote_success(jid)))
    monkeypatch.setattr(artifacts, "fetch", lambda jid: b":00000001FF\n" if jid == job_id else None)

    r = client.get(f"/api/compile/{job_id}/artifact")
    assert r.status_code == 200
    assert r.content == b":00000001FF\n"
    assert 'filename="circuito-vivo-uno.hex"' in r.headers["content-disposition"]
    assert r.headers["x-artifact-name"] == "sketch.ino.hex"
    assert r.headers["cache-control"] == "no-store"


def test_artifact_404_when_expired_everywhere(client, monkeypatch):
    job_id = jobs.new_job_id()
    jobs.job_dir(job_id).mkdir(parents=True)
    monkeypatch.setattr(compile_router, "_celery_state", lambda jid: ("SUCCESS", _remote_success(jid)))
    monkeypatch.setattr(artifacts, "fetch", lambda jid: None)
    assert client.get(f"/api/compile/{job_id}/artifact").status_code == 404


def test_artifact_404_while_remote_job_unfinished(client, monkeypatch):
    job_id = jobs.new_job_id()
    jobs.job_dir(job_id).mkdir(parents=True)
    monkeypatch.setattr(compile_router, "_celery_state", lambda jid: ("STARTED", None))
    monkeypatch.setattr(artifacts, "fetch", lambda jid: pytest.fail("must not read Redis for an unfinished job"))
    assert client.get(f"/api/compile/{job_id}/artifact").status_code == 404


def test_artifact_name_cannot_escape_job_dir(client, monkeypatch):
    job_id = jobs.new_job_id()
    jobs.job_dir(job_id).mkdir(parents=True)
    evil = {**_remote_success(job_id), "artifactName": "../../etc/passwd"}
    monkeypatch.setattr(compile_router, "_celery_state", lambda jid: ("SUCCESS", evil))
    monkeypatch.setattr(artifacts, "fetch", lambda jid: pytest.fail("must not serve a traversal name"))
    assert client.get(f"/api/compile/{job_id}/artifact").status_code == 404


def test_publish_and_fetch_never_raise_without_redis(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:1/0")  # nothing listens on port 1
    binary = tmp_path / "sketch.ino.hex"
    binary.write_bytes(b":00000001FF\n")
    assert artifacts.publish(jobs.new_job_id(), binary) is False
    assert artifacts.fetch(jobs.new_job_id()) is None


def test_health_reports_deployed_commit(monkeypatch):
    monkeypatch.setattr(settings, "render_git_commit", "abc123")
    assert health()["commit"] == "abc123"
    monkeypatch.setattr(settings, "render_git_commit", "")
    assert health()["commit"] is None
