"""The VLM prompt, its JSON schema and the image inputs — shared by production (vlm.py) and
the fine-tuning dataset (training/vlm/build_dataset.py), so both see exactly the same thing.

Inputs: the full frame + a 2× crop around the expected holes with those holes drawn,
the expected step as JSON and the suspected problem (from the geometric rules).
Output (strict JSON, vLLM guided decoding):
    {"estado": "ok|error|incierto", "tipo": <IssueKind|"ninguno">, "componente": str, "mensaje": str}
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

TIPOS = ["ninguno", "missing", "wrong_hole", "led_reversed", "wrong_part", "wire_wrong_end", "extra_part"]
ESTADOS = ["ok", "error", "incierto"]

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "estado": {"type": "string", "enum": ESTADOS},
        "tipo": {"type": "string", "enum": TIPOS},
        "componente": {"type": "string", "maxLength": 40},
        "mensaje": {"type": "string", "maxLength": 160},
    },
    "required": ["estado", "tipo", "componente", "mensaje"],
    "additionalProperties": False,
}

SYSTEM = """Eres el ayudante de armado de Circuito Vivo. Miras por una cámara fija una protoboard \
(400 puntos: columnas 1 a 30, filas a–e arriba y f–j abajo, rieles + y − arriba y abajo) y un \
Arduino Uno. Revisas UN paso de armado a la vez y respondes SOLO con JSON.

Imagen 1: la mesa completa. Imagen 2: acercamiento al lugar del paso; los círculos verdes marcan \
los huecos donde DEBE ir cada pata o punta de cable, con su nombre (ej. e10).

Reglas:
- "ok": el paso está bien hecho (las patas en esos huecos o en la misma columna de esa mitad de la protoboard; \
en un LED la pata larga, el ánodo, en el hueco del ánodo).
- "error": se ve un problema concreto. "tipo": missing (falta la pieza), wrong_hole (corrida a otra columna o \
fila), led_reversed (LED o pieza con polaridad al revés), wrong_part (otra pieza u otro color), \
wire_wrong_end (un extremo del cable en otro lugar), extra_part (sobra algo en esa zona).
- "incierto": la mano tapa, está borroso o no se alcanza a ver. Ante la duda, "incierto".
- "componente": la pieza que revisaste (ej. "LED rojo", "R1", "cable amarillo").
- "mensaje": UNA frase corta en español de Chile, para decirla en voz alta, cálida y directa, sin tecnicismos \
innecesarios. Si hay error, di qué está mal y cómo arreglarlo (ej. "Ojo, el LED está al revés: la pata larga va \
en e7."). Si está ok, una felicitación corta (ej. "Bien ahí, el LED quedó perfecto."). Si es incierto, "".\
"""


@dataclass
class StepInfo:
    """What the step expects, in words the model can check."""

    paso: int
    titulo: str
    detalle: str
    piezas: list[dict]  # [{"pieza": "LED rojo", "pata": "ánodo (pata larga)", "hueco": "e7"}]
    cables: list[dict]  # [{"cable": "amarillo", "desde": "pin 13 del Arduino", "hasta": "a1"}]

    def as_json(self) -> str:
        return json.dumps(self.__dict__, ensure_ascii=False)


def user_text(step: StepInfo, suspected: str | None) -> str:
    hint = (
        f"\nLas reglas geométricas sospechan: {suspected}. Confírmalo o descártalo mirando las imágenes."
        if suspected
        else ""
    )
    return f"Paso esperado:\n{step.as_json()}{hint}\nResponde solo el JSON."


def b64_jpeg(img: np.ndarray, quality: int = 85) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("jpeg encode failed")
    return base64.b64encode(buf.tobytes()).decode()


def make_crop(
    img: np.ndarray,
    holes_px: dict[str, tuple[float, float]],
    pitch_px: float,
    margin_pitches: float = 4.0,
    max_side: int = 512,
) -> np.ndarray:
    """Crop around the expected holes (margin in hole pitches), upscale ~2×, draw and label the holes."""
    h, w = img.shape[:2]
    if not holes_px:
        return img.copy()
    pts = np.array(list(holes_px.values()), dtype=np.float64)
    m = max(margin_pitches * pitch_px, 24)
    x1, y1 = np.maximum(pts.min(0) - m, 0).astype(int)
    x2, y2 = np.minimum(pts.max(0) + m, [w - 1, h - 1]).astype(int)
    crop = img[y1 : y2 + 1, x1 : x2 + 1]
    scale = min(2.0, max_side / max(crop.shape[:2]))
    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    r = max(3, int(pitch_px * scale * 0.45))
    for name, (x, y) in holes_px.items():
        cx, cy = int(round((x - x1) * scale)), int(round((y - y1) * scale))
        cv2.circle(crop, (cx, cy), r, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.circle(crop, (cx, cy), r, (80, 220, 120), 2, cv2.LINE_AA)
        cv2.putText(crop, name, (cx + r + 2, cy - r), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(crop, name, (cx + r + 2, cy - r), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80, 220, 120), 1, cv2.LINE_AA)
    return crop


def build_messages(step: StepInfo, suspected: str | None, frame_b64: str, crop_b64: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{crop_b64}"}},
                {"type": "text", "text": user_text(step, suspected)},
            ],
        },
    ]


@dataclass
class Verdict:
    estado: str
    tipo: str
    componente: str
    mensaje: str

    @property
    def ok(self) -> bool:
        return self.estado == "ok"

    @property
    def error(self) -> bool:
        return self.estado == "error" and self.tipo != "ninguno"


def parse_verdict(text: str) -> Verdict | None:
    """Parse the model output (strict JSON; tolerate code fences). None if unusable."""
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{") :]
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j < i:
        return None
    try:
        d = json.loads(t[i : j + 1])
    except json.JSONDecodeError:
        return None
    estado = d.get("estado")
    tipo = d.get("tipo", "ninguno")
    if estado not in ESTADOS or tipo not in TIPOS:
        return None
    if (estado == "ok" and tipo != "ninguno") or (estado == "error" and tipo == "ninguno"):
        estado, tipo = "incierto", "ninguno"  # self-contradicting answer: do not act on it
    return Verdict(estado, tipo, str(d.get("componente", ""))[:40], str(d.get("mensaje", ""))[:160])
