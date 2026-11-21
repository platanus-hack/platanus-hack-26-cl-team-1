"""Smoke test + latency of a deployed demo, from outside: a real session over the public WebSocket.

Sends JPEGs to /ws/session like the browser does (~6 fps, debug on) and reports:
  - ack RTT: frame sent → the server's `debug` ack for that seq (network + tunnel round trip);
  - observation latency: frame sent → the VLM `debug` observation for that seq (round trip + perception);
  - perception latency as the server measured it (`latency_ms.perception`).
Fails (exit 1) if no observation arrives. Run from server/ (it uses the contracts package):

    uv run python ../deploy/smoke.py https://<tunnel>.trycloudflare.com <task_id> a.jpg [b.jpg …]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

import websockets
from contracts.protocol import pack_frame


def pct(values: list[float], q: float) -> float:
    return statistics.quantiles(values, n=100, method="inclusive")[q - 1] if len(values) > 1 else values[0]


async def run(url: str, task_id: str, jpegs: list[bytes], seconds: float, fps: float) -> int:
    ws_url = url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + "/ws/session"
    sent: dict[int, float] = {}
    acks: list[float] = []
    obs: list[float] = []
    server_ms: list[int] = []
    actions: list[str | None] = []
    errors: list[str] = []
    async with websockets.connect(ws_url, max_size=None) as ws:
        hello = {"type": "hello", "protocol": 1, "task_id": task_id, "source": "webcam", "debug": True}
        await ws.send(json.dumps(hello))
        ready = json.loads(await ws.recv())
        if ready.get("type") != "ready":
            print(f"✘ expected ready, got {ready}")
            return 1

        async def reader() -> None:
            async for raw in ws:
                if isinstance(raw, bytes):
                    continue  # audio
                msg = json.loads(raw)
                now = time.perf_counter()
                if msg["type"] == "debug" and msg["seq"] in sent:
                    rtt = (now - sent[msg["seq"]]) * 1000
                    if msg.get("observation") is None:
                        acks.append(rtt)
                    else:
                        obs.append(rtt)
                        server_ms.append(msg["latency_ms"].get("perception", 0))
                        actions.append(msg["observation"].get("action"))
                elif msg["type"] == "error":
                    errors.append(msg["message"])

        task = asyncio.create_task(reader())
        t0 = time.perf_counter()
        seq = 0
        while time.perf_counter() - t0 < seconds:
            t_ms = int((time.perf_counter() - t0) * 1000)
            sent[seq] = time.perf_counter()
            await ws.send(pack_frame(seq, t_ms, jpegs[seq % len(jpegs)]))
            seq += 1
            await asyncio.sleep(1 / fps)
        await asyncio.sleep(3)  # let the last observation land
        task.cancel()

    print(f"frames sent: {seq}, acks: {len(acks)}, observations: {len(obs)}, errors: {len(errors)}")
    if acks:
        print(f"ack RTT ms           p50 {pct(acks, 50):.0f}  p95 {pct(acks, 95):.0f}")
    if obs:
        print(f"observation ms       p50 {pct(obs, 50):.0f}  p95 {pct(obs, 95):.0f}")
        print(f"server perception ms p50 {pct(server_ms, 50):.0f}  p95 {pct(server_ms, 95):.0f}")
        print(f"actions seen: {sorted({str(a) for a in actions})}")
    for e in errors[:3]:
        print(f"error: {e}")
    return 0 if obs and not errors else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("url")
    p.add_argument("task_id")
    p.add_argument("jpegs", nargs="+", type=Path)
    p.add_argument("--seconds", type=float, default=20)
    p.add_argument("--fps", type=float, default=6)
    a = p.parse_args()
    sys.exit(asyncio.run(run(a.url, a.task_id, [j.read_bytes() for j in a.jpegs], a.seconds, a.fps)))


if __name__ == "__main__":
    main()
