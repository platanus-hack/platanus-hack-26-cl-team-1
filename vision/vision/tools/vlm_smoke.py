"""Smoke test of the VLM served by vLLM: describe a breadboard photo and time it.

uv run python -m vision.tools.vlm_smoke path/to/photo.jpg [--runs 3]
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import time

from openai import OpenAI
from PIL import Image

PROMPT = (
    "Describe en español, en 2 o 3 frases cortas, qué hay en esta protoboard: "
    "componentes, colores de cables y dónde están conectados."
)


def to_data_url(path: str, max_side: int = 640) -> str:
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--model", default=os.environ.get("VLM_SERVED", "qwen3vl"))
    args = ap.parse_args()
    client = OpenAI(base_url=os.environ.get("VLLM_URL", "http://127.0.0.1:8001") + "/v1", api_key="local")
    url = to_data_url(args.image)
    for i in range(args.runs):
        t0 = time.perf_counter()
        r = client.chat.completions.create(
            model=args.model,
            messages=[
                {
                    "role": "user",
                    "content": [{"type": "image_url", "image_url": {"url": url}}, {"type": "text", "text": PROMPT}],
                }
            ],
            max_tokens=120,
            temperature=0,
        )
        dt = time.perf_counter() - t0
        u = r.usage
        print(f"run {i + 1}: {dt:.2f} s (prompt {u.prompt_tokens} tok, salida {u.completion_tokens} tok)")
    print(r.choices[0].message.content)


if __name__ == "__main__":
    main()
