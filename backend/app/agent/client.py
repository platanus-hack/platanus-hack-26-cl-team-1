"""Anthropic client factory (tests monkeypatch `client_factory`)."""
from __future__ import annotations

from typing import Any, Callable, Optional

import anthropic

from ..settings import settings

_cached: Optional[tuple[tuple[str, str], Any]] = None


def _default_factory() -> Any:
    """One AsyncAnthropic per process (per API key + base URL): its connection pool is reused by
    every turn instead of opening a new client and TLS connection for each tool iteration.

    `anthropic_base_url` only reroutes traffic (e.g. the hackathon LLM proxy); the proxy is
    pass-through, so the API key is still required. It is passed explicitly because
    pydantic-settings reads backend/.env into `settings`, not into os.environ."""
    global _cached
    cfg = (settings.anthropic_api_key, settings.anthropic_base_url)
    if _cached is None or _cached[0] != cfg:
        key, base_url = cfg
        _cached = (cfg, anthropic.AsyncAnthropic(api_key=key, base_url=base_url or None, max_retries=2))
    return _cached[1]


#: Returns an object exposing `.beta.messages.stream(**params)` (AsyncAnthropic).
client_factory: Callable[[], Any] = _default_factory


def get_client() -> Any:
    return client_factory()
