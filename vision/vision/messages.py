"""Spoken lines (Chilean Spanish) for each issue kind. Used when the VLM times out, and as the
target `mensaje` of the VLM fine-tuning dataset (training/vlm/build_dataset.py)."""

from __future__ import annotations

import random

from .expected import WIRE_COLORS_ES, Expected, PartInfo, StepExpect, WireEnd

PIN_ES = {
    "anode": "ánodo (pata larga)",
    "cathode": "cátodo (pata corta)",
    "plus": "pata +",
    "minus": "pata −",
    "a": "una pata",
    "b": "la otra pata",
    "wiper": "pata del medio",
}
_LED_COLOR = {"red": "rojo", "green": "verde", "yellow": "amarillo", "blue": "azul", "white": "blanco"}


def part_name(p: PartInfo) -> str:
    """'el LED rojo', 'la resistencia R1', 'el botón'…"""
    if p.type == "led":
        return f"el LED {_LED_COLOR.get(str(p.props.get('color')), '')}".strip()
    if p.type == "resistor":
        return f"la resistencia {p.label}" if p.label and not p.label.lower().startswith("resist") else "la resistencia"
    return {
        "button": "el botón",
        "potentiometer": "el potenciómetro",
        "buzzer": "el buzzer",
        "diode": "el diodo",
        "ldr": "la fotorresistencia",
        "npn": "el transistor",
        "arduino-uno": "el Arduino",
    }.get(p.type, p.label or "la pieza")


def end_name(e: WireEnd) -> str:
    if e.hole:
        if e.hole[:2] in ("T+", "T-", "B+", "B-"):
            return f"el riel {'+' if e.hole[1] == '+' else '−'}"
        return e.hole
    if e.board_pin:
        pin = e.board_pin
        if pin.startswith("GND"):
            return "GND del Arduino"
        if pin.startswith("D"):
            return f"el pin {pin[1:]} del Arduino"
        return f"el pin {pin} del Arduino"
    return e.part_pin or "?"


def wire_name(step: StepExpect) -> str:
    return f"el cable {WIRE_COLORS_ES.get(step.wire_color or '', '')}".strip()


def component(exp: Expected, step: StepExpect) -> str:
    if step.part and step.part in exp.parts:
        return part_name(exp.parts[step.part])
    if step.wire:
        return wire_name(step)
    return "esa pieza"


def _g(name: str, masc: str, fem: str) -> str:
    """Gender agreement from the article: 'la resistencia' → fem, 'el LED' → masc."""
    return fem if name.startswith("la ") else masc


def _cols(n: int) -> str:
    return "una columna" if abs(n) == 1 else f"{abs(n)} columnas"


def issue_line(
    kind: str,
    exp: Expected,
    step: StepExpect,
    *,
    shift: int = 0,
    observed_hole: str | None = None,
    rng: random.Random | None = None,
) -> str:
    r = rng or random
    name = component(exp, step)
    holes = [leg.hole for leg in step.legs]
    where = " y ".join(holes[:2]) if holes else ""
    if kind == "wrong_hole":
        extra = f" Va en {where}." if where else ""
        if shift == 0:  # direction unknown (dataset labels, VLM-only checks)
            return f"{r.choice(['Ojo', 'Ojo ahí'])}, {name} quedó en otra columna.{extra}"
        side = "a la derecha" if shift > 0 else "a la izquierda"
        return f"{r.choice(['Ojo', 'Ojo ahí'])}, {name} quedó {_g(name, 'corrido', 'corrida')} {_cols(shift)} {side}.{extra}"
    if kind == "led_reversed":
        anode = next((leg.hole for leg in step.legs if leg.pin in ("anode", "plus")), None)
        tail = f" la pata larga va en {anode}." if anode else " dale vuelta."
        return f"Ojo, {name} está al revés:{tail}"
    if kind == "wrong_part":
        return f"Ojo, esa no es la pieza: en {where or 'ese lugar'} va {name}."
    if kind == "wire_wrong_end":
        target = next((e for e in step.wire_ends if e.hole and e.hole != observed_hole), None) or (
            step.wire_ends[-1] if step.wire_ends else None
        )
        dest = end_name(target) if target else "su lugar"
        now = f", no en {observed_hole}" if observed_hole else ""
        return f"Ojo, {name} va en {dest}{now}."
    if kind == "missing":
        return f"Falta {name}{' en ' + where if where else ''}."
    if kind == "extra_part":
        return f"Sobra una pieza cerca de {where or 'ese paso'}: sácala al tiro."
    return f"Revisa {name}."


def ok_line(exp: Expected, step: StepExpect, rng: random.Random | None = None) -> str:
    name = component(exp, step)
    return (rng or random).choice(
        [
            f"Bien ahí, {name} quedó {_g(name, 'perfecto', 'perfecta')}.",
            f"Listo, {name} está bien {_g(name, 'puesto', 'puesta')}.",
            f"Perfecto, {name} quedó donde va.",
        ]
    )


def fixed_line(rng: random.Random | None = None) -> str:
    return (rng or random).choice(["Bien, ahora sí.", "Eso, ahora sí quedó.", "Perfecto, corregido."])


def stall_line(step: dict) -> str:
    tip = step.get("tip")
    detail = step.get("detail", "")
    return f"¿Te ayudo? {tip}" if tip else f"¿Te ayudo? {detail}"
