"""FastAPI entry point of the vision server.

    uv run uvicorn vision.app:app --host 127.0.0.1 --port 8100

Exposed to the browser through a Cloudflare Tunnel (HTTPS/WSS).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

VLLM_URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8001")

app = FastAPI(title="Circuito Vivo — visión")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=1)
def gpu_name() -> str | None:
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=5
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return out.splitlines()[0].replace("NVIDIA GeForce ", "") if out else None


async def vllm_up() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            r = await c.get(f"{VLLM_URL}/v1/models")
            return r.status_code == 200
    except httpx.HTTPError:
        return False


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "gpu": gpu_name(), "vllm": await vllm_up()}
