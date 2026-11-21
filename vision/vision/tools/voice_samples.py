"""Render the same Chilean-flavoured lines with every Spanish Kokoro voice.

uv run python -m vision.tools.voice_samples --out out/voces
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from vision.tts import VOICES, Tts

LINES = [
    "Hola, empecemos. Primer paso: coloca el LED rojo, pata larga en e10 y pata corta en e11.",
    "Ojo, el LED está al revés: la pata larga va en e10. Dale vuelta y seguimos.",
    "¡Bien ahí! Ese paso está listo. Ahora el cable rojo, del pin D13 a la columna 10.",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out/voces")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tts = Tts(VOICES[0])
    for voice in VOICES:
        tts.voice = voice
        tts.synth("Hola.")
        t0 = time.perf_counter()
        wav = tts.wav(" ".join(LINES))
        print(f"{voice}: {time.perf_counter() - t0:.2f} s para {len(wav) / 48000:.1f} s de audio")
        (out / f"{voice}.wav").write_bytes(wav)


if __name__ == "__main__":
    main()
