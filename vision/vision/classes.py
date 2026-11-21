"""YOLO classes of the Modo Armado detector: the single source of truth for ids, names and prompts.

The order is the class id (0..9) used in label files, data.yaml and the trained model.
`prompt_en` / `prompt_es` feed zero-shot detectors (YOLO-World, Qwen3-VL grounding) when auto-labelling.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class YoloClass:
    name: str  # identifier in labels / data.yaml
    es: str  # short Spanish label for the UI
    prompt_en: str
    prompt_es: str
    color: str  # box colour in the reviewer


CLASS_SPECS: tuple[YoloClass, ...] = (
    YoloClass("arduino_uno", "Arduino Uno", "Arduino Uno board", "placa Arduino Uno", "#4FA3FF"),
    YoloClass("led_red", "LED rojo", "red LED", "LED rojo", "#FF5C5C"),
    YoloClass("led_green", "LED verde", "green LED", "LED verde", "#5BE35B"),
    YoloClass("led_yellow", "LED amarillo", "yellow LED", "LED amarillo", "#FFD84D"),
    YoloClass("resistor", "Resistencia", "resistor", "resistencia", "#D9A066"),
    YoloClass("button", "Botón", "push button", "botón pulsador", "#B98CFF"),
    YoloClass("potentiometer", "Potenciómetro", "potentiometer", "potenciómetro", "#4DE3E3"),
    YoloClass("buzzer", "Buzzer", "piezo buzzer", "buzzer piezoeléctrico", "#FF8FD1"),
    YoloClass(
        "wire_end",
        "Punta de cable",
        "tip of a jumper wire plugged into the breadboard",
        "punta de un cable jumper enchufada en la protoboard",
        "#FF9F43",
    ),
    YoloClass("hand", "Mano", "human hand", "mano", "#C8CDD3"),
)

CLASSES: tuple[str, ...] = tuple(c.name for c in CLASS_SPECS)
CLASS_ID: dict[str, int] = {n: i for i, n in enumerate(CLASSES)}
NC = len(CLASSES)
# Text prompts for zero-shot detectors (YOLO-World understands English best).
PROMPTS: dict[str, str] = {c.name: c.prompt_en for c in CLASS_SPECS}
