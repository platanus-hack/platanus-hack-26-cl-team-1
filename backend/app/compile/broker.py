"""Fast broker / worker probes, so a stopped Redis or a missing Celery worker never leaves a compile hanging."""
from __future__ import annotations

import time

import redis

from ..settings import settings

_cache: dict[str, tuple[float, bool]] = {}


def _cached(key: str, ttl_ok: float, ttl_fail: float) -> bool | None:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < (ttl_ok if hit[1] else ttl_fail):
        return hit[1]
    return None


def broker_reachable() -> bool:
    hit = _cached("broker", 5.0, 5.0)
    if hit is not None:
        return hit
    try:
        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.3, socket_timeout=0.5)
        ok = bool(client.ping())
        client.close()
    except Exception:  # noqa: BLE001
        ok = False
    _cache["broker"] = (time.monotonic(), ok)
    return ok


def workers_available() -> bool:
    """At least one Celery worker answers a ping (cached 30 s when yes, 5 s when no)."""
    hit = _cached("workers", 30.0, 5.0)
    if hit is not None:
        return hit
    ok = False
    if broker_reachable():
        try:
            from .celery_app import celery_app

            ok = bool(celery_app.control.ping(timeout=0.8, limit=1))
        except Exception:  # noqa: BLE001
            ok = False
    _cache["workers"] = (time.monotonic(), ok)
    return ok
