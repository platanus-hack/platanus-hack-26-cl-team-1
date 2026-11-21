"""Qwen3-VL (served by vLLM) as a per-event judge. Never more than one call in flight;
2 s timeout → the caller keeps the geometric verdict."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass

import httpx

from .vlm_prompt import SCHEMA, StepInfo, Verdict, build_messages, parse_verdict

log = logging.getLogger(__name__)


@dataclass
class VlmResult:
    verdict: Verdict | None
    latency_ms: float
    error: str | None = None


class VlmJudge:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout_s: float = 2.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("VLLM_URL", "http://127.0.0.1:8001")).rstrip("/")
        # VLM_SERVED: "qwen3vl" (base) or "armado" (the LoRA adapter, when vLLM runs with VLM_LORA)
        self.model = model or os.environ.get("VLM_SERVED", "qwen3vl")
        self.timeout_s = timeout_s
        self._client = client or httpx.AsyncClient(timeout=timeout_s + 0.5)
        self._lock = asyncio.Lock()
        self.calls = 0
        self.last_latency_ms = 0.0

    async def warmup(self) -> None:
        """First guided-JSON call compiles the grammar (~1 s): pay it at startup, not on the first event."""
        import numpy as np

        from .vlm_prompt import b64_jpeg

        img = b64_jpeg(np.full((64, 64, 3), 200, np.uint8))
        r = await self.judge(StepInfo(0, "prueba", "", [], []), None, img, img)
        log.info("VLM precalentado en %.0f ms (%s)", r.latency_ms, r.error or "ok")

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    async def judge(self, step: StepInfo, suspected: str | None, frame_b64: str, crop_b64: str) -> VlmResult:
        if self._lock.locked():
            return VlmResult(None, 0.0, "busy")
        async with self._lock:
            t0 = time.perf_counter()
            body = {
                "model": self.model,
                "messages": build_messages(step, suspected, frame_b64, crop_b64),
                "temperature": 0,
                "max_tokens": 120,
                "response_format": {"type": "json_schema", "json_schema": {"name": "veredicto", "schema": SCHEMA}},
            }
            try:
                r = await asyncio.wait_for(
                    self._client.post(f"{self.base_url}/v1/chat/completions", json=body), self.timeout_s
                )
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"] or ""
                v = parse_verdict(text)
                err = None if v else f"salida inválida: {text[:80]!r}"
            except TimeoutError:
                v, err = None, "timeout"
            except (httpx.HTTPError, KeyError, ValueError) as e:
                v, err = None, f"{type(e).__name__}: {e}"
            dt = (time.perf_counter() - t0) * 1000
            self.calls += 1
            self.last_latency_ms = dt
            if err:
                log.warning("VLM %s (%.0f ms)", err, dt)
            return VlmResult(v, dt, err)
