"""End-to-end probe of /ws/session: hello → greeting audio, N frames → latency.

    uv run python -m vision.tools.ws_probe wss://<tunnel>/ws/session [--frames 30] [--image foto.jpg]

Without --image it sends a synthetic frame of the printed mat (seen in perspective).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
import websockets

from vision.protocol import decode_frame, encode_frame  # noqa: F401  (decode kept for symmetry)

STEPS = [
    {"id": "bb-bb1", "index": 1, "kind": "breadboard", "title": "Prepara la protoboard", "detail": "", "highlight": []},
    {
        "id": "part-led1",
        "index": 2,
        "kind": "part",
        "title": "Coloca el LED rojo",
        "detail": "Pata larga (ánodo) en e10, pata corta (cátodo) en e11.",
        "highlight": ["led1", "bb1.e10", "bb1.e11"],
    },
]


def synthetic_frame() -> bytes:
    from vision.tools import make_markers as mm

    page = np.array(mm.render_mat())
    page = cv2.resize(page, (640, 452), interpolation=cv2.INTER_AREA)
    frame = np.full((480, 640), 200, np.uint8)
    frame[14:466] = page
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR), [cv2.IMWRITE_JPEG_QUALITY, 70])
    return buf.tobytes()


async def probe(url: str, frames: int, image: str | None, out: Path) -> None:
    jpeg = Path(image).read_bytes() if image else synthetic_frame()
    hello = {
        "type": "hello",
        "protocol": 1,
        "project": {"parts": [], "wires": []},
        "netlist": {"nets": [], "pinNet": {}, "insertions": []},
        "steps": STEPS,
        "parts": {},
        "record": False,
        "debug": True,
    }
    t_conn = time.perf_counter()
    async with websockets.connect(url, max_size=8 * 1024 * 1024) as ws:
        print(f"conectado en {(time.perf_counter() - t_conn) * 1000:.0f} ms")
        t_hello = time.perf_counter()
        await ws.send(json.dumps(hello))
        got_audio = False
        say_at = None
        while not got_audio:
            m = await asyncio.wait_for(ws.recv(), 10)
            if isinstance(m, bytes):
                n = m[0]
                clip, wav = m[1 : 1 + n].decode(), m[1 + n :]
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(wav)
                print(
                    f"audio {clip}: {len(wav) / 48000:.1f} s, llegó {(time.perf_counter() - t_hello) * 1000:.0f} ms tras hello → {out}"
                )
                got_audio = True
            else:
                d = json.loads(m)
                if d["type"] == "say":
                    say_at = time.perf_counter()
                    print(f"say ({(say_at - t_hello) * 1000:.0f} ms): {d['text']}")
                    if not d["audio"]:
                        break
                else:
                    print("←", d["type"], {k: v for k, v in d.items() if k not in ("type", "H")})
        rtts, server = [], []
        for seq in range(1, frames + 1):
            t0 = time.perf_counter()
            await ws.send(encode_frame(seq, int(t0 * 1000), jpeg))
            while True:
                m = await asyncio.wait_for(ws.recv(), 10)
                if isinstance(m, bytes):
                    continue
                d = json.loads(m)
                if d["type"] == "debug" and d["seq"] == seq:
                    rtts.append((time.perf_counter() - t0) * 1000)
                    server.append(d["latency_ms"]["total"])
                    break
                if d["type"] == "calibration":
                    print("← calibration", {k: v for k, v in d.items() if k != "H"})
        if rtts:
            rtts.sort()
            print(
                f"frame→debug ({len(jpeg) // 1024} KB): p50 {statistics.median(rtts):.0f} ms · "
                f"p95 {rtts[int(len(rtts) * 0.95) - 1]:.0f} ms · servidor p50 {statistics.median(server):.1f} ms"
            )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--image")
    ap.add_argument("--out", default="out/probe.wav")
    a = ap.parse_args()
    asyncio.run(probe(a.url, a.frames, a.image, Path(a.out)))


if __name__ == "__main__":
    main()
