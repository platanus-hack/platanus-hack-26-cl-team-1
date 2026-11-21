"""Compiled binaries handed from the worker to the API through Redis.

docker compose shares one build volume between the api and the worker, so the API serves the
artifact straight from disk. On hosts where every service has its own filesystem (Render), the
worker also stores the binary in Redis and the API falls back to it. Best effort: any Redis error
just means "not available" and never breaks a compile.
"""
from __future__ import annotations

import logging
from pathlib import Path

import redis

from ..settings import settings
from .jobs import JOB_TTL_S

log = logging.getLogger(__name__)

#: A merged ESP32-C6 image is ~0.3-1.5 MB; anything far bigger is not a sketch binary.
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024


def _key(job_id: str) -> str:
    return f"circuito-vivo:artifact:{job_id}"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1.0, socket_timeout=5.0)


def publish(job_id: str, path: Path) -> bool:
    try:
        data = path.read_bytes()
        if len(data) > MAX_ARTIFACT_BYTES:
            log.warning("artifact of %s too big for Redis (%d bytes)", job_id, len(data))
            return False
        client = _client()
        try:
            client.set(_key(job_id), data, ex=JOB_TTL_S)
        finally:
            client.close()
        return True
    except Exception:  # noqa: BLE001
        log.warning("could not publish artifact of %s to Redis", job_id, exc_info=True)
        return False


def fetch(job_id: str) -> bytes | None:
    try:
        client = _client()
        try:
            data = client.get(_key(job_id))
        finally:
            client.close()
    except Exception:  # noqa: BLE001
        log.warning("could not read artifact of %s from Redis", job_id, exc_info=True)
        return None
    return data if isinstance(data, bytes) else None
