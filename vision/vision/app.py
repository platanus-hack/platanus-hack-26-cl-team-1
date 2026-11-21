"""FastAPI entry point of the vision server.

    uv run uvicorn vision.app:app --host 127.0.0.1 --port 8100

Exposed to the browser through a Cloudflare Tunnel (HTTPS/WSS).
Env: CV_DATA (data dir), CV_TTS=0 (no Kokoro), CV_VOICE (ef_dora), VLLM_URL.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .assembly import AssemblySession
from .review import router as review_router
from .session import Config, Session

log = logging.getLogger("vision")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

VLLM_URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8001")
DATA = Path(os.environ.get("CV_DATA", "data")).expanduser()


class State:
    tts = None
    voice: str | None = None
    detector = None
    judge = None
    warmup = None


STATE = State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("CV_DETECTOR", "1") != "0":
        try:
            from .detector import Detector

            STATE.detector = await asyncio.to_thread(Detector)
        except Exception as e:  # noqa: BLE001 — without a detector the VLM judges part/wire steps alone
            log.warning("sin detector (%s): los pasos se revisan solo con el VLM", e)
    if os.environ.get("CV_VLM", "1") != "0":
        from .vlm import VlmJudge

        STATE.judge = VlmJudge()
        STATE.warmup = asyncio.create_task(STATE.judge.warmup())
    if os.environ.get("CV_TTS", "1") != "0":
        try:
            from .tts import Tts

            voice = os.environ.get("CV_VOICE", "ef_dora")
            STATE.tts = await asyncio.to_thread(Tts, voice)
            STATE.voice = voice
            log.info("Kokoro listo (voz %s)", voice)
        except Exception as e:  # noqa: BLE001 — no TTS → the browser speaks the text itself
            log.warning("sin TTS (%s): el navegador leerá el texto", e)
    yield


app = FastAPI(title="Circuito Vivo — visión", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(review_router)  # /review: YOLO label reviewer (F4)


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
            r = await c.get(f"{os.environ.get('VLLM_URL', VLLM_URL)}/v1/models")
            return r.status_code == 200
    except httpx.HTTPError:
        return False


@app.get("/health")
async def health() -> dict:
    det = STATE.detector
    return {
        "ok": True,
        "gpu": gpu_name(),
        "vllm": await vllm_up(),
        "voice": STATE.voice,
        "detector": None if det is None else Path(det.weights).name,
    }


def make_config() -> Config:
    return Config(
        data_dir=DATA,
        synth=STATE.tts.wav if STATE.tts is not None else None,
        voice=STATE.voice,
        calib_path=DATA / "calib.json",
    )


def make_session(ws: WebSocket) -> Session:
    return AssemblySession(ws, make_config(), STATE.detector, STATE.judge)


@app.websocket("/ws/session")
async def ws_session(ws: WebSocket) -> None:
    await ws.accept()
    session = make_session(ws)
    log.info("sesión %s abierta", session.id)
    try:
        await session.run()
    finally:
        log.info("sesión %s cerrada", session.id)
