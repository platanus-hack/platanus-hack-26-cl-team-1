"""Render the reference sections of the system prompt from /shared data.

Everything here is deterministic (sorted file lists, fixed key order) so the
system prompt is byte-stable across restarts and the prompt cache keeps hitting.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Json = dict[str, Any]

# Palette order used by the frontend catalog (unknown types go last, by name).
PART_ORDER = [
    "arduino-uno", "esp32c6-devkit", "breadboard-half", "battery-9v", "battery-aa4",
    "led", "led-rgb", "buzzer", "motor-dc", "servo-sg90",
    "button", "switch-slide", "potentiometer", "ldr",
    "resistor", "diode", "npn",
]

CATEGORY_ES = {
    "boards": "placas", "power": "energía", "passive": "pasivos", "output": "salidas",
    "input": "entradas", "semiconductor": "semiconductores", "prototyping": "prototipado",
}

COLOR_ES = {"red": "rojo", "green": "verde", "yellow": "amarillo", "blue": "azul", "white": "blanco"}


@dataclass(frozen=True)
class SharedData:
    parts: list[Json]
    boards: dict[str, Json]
    examples: list[Json]
    ir_reference: str
    tools: list[Json]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_shared(shared_dir: Path) -> SharedData:
    parts = [_read_json(p) for p in sorted((shared_dir / "parts").glob("*.json"))]
    order = {t: i for i, t in enumerate(PART_ORDER)}
    parts.sort(key=lambda d: (order.get(d["type"], len(order)), d["type"]))
    boards = {b["id"]: b for b in (_read_json(p) for p in sorted((shared_dir / "boards").glob("*.json")))}
    examples = _read_json(shared_dir / "examples.json")
    ir_reference = (shared_dir / "ir-reference.md").read_text(encoding="utf-8").strip()
    tools = _read_json(shared_dir / "agent-tools.json")
    return SharedData(parts=parts, boards=boards, examples=examples, ir_reference=ir_reference, tools=tools)


# ----------------------------------------------------------------------------- helpers


def _num(v: Any) -> str:
    """Compact Spanish-ish number: 1.9 → '1.9', 220.0 → '220'."""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def _ohms(v: Any) -> str:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return str(v)
    if x >= 1e6:
        return f"{_num(round(x / 1e6, 2))} MΩ"
    if x >= 1e3:
        return f"{_num(round(x / 1e3, 2))} kΩ"
    return f"{_num(x)} Ω"


def _prop_line(p: Json) -> str:
    key, kind = p["key"], p["type"]
    runtime = " · cambia en vivo durante la simulación" if p.get("runtime") else ""
    if kind == "enum":
        opts = " | ".join(_num(o["value"]) for o in p.get("options", []))
        return f"`{key}` ({p['label']}): {opts} — por defecto {_num(p['default'])}{runtime}"
    if kind == "number":
        rng = ""
        if "min" in p or "max" in p:
            rng = f" {_num(p.get('min', ''))}..{_num(p.get('max', ''))}"
        unit = f" {p['unit']}" if p.get("unit") else ""
        return f"`{key}` ({p['label']}): número{rng}{unit} — por defecto {_num(p['default'])}{runtime}"
    return f"`{key}` ({p['label']}): true/false — por defecto {str(p['default']).lower()}{runtime}"


def _electrical_line(el: Json) -> str | None:
    m = el.get("model")
    if m == "led":
        vf = ", ".join(f"{COLOR_ES.get(c, c)} {_num(v)} V" for c, v in el["vf"].items())
        return f"Vf: {vf}. Brillo pleno a {_num(el['ratedmA'])} mA; se quema sobre {_num(el['maxmA'])} mA."
    if m == "rgb-led":
        vf = el["vf"]
        return (
            f"Cátodo común. Vf R {_num(vf['r'])} V, G {_num(vf['g'])} V, B {_num(vf['b'])} V. "
            f"{_num(el['ratedmA'])} mA por color; se quema sobre {_num(el['maxmA'])} mA. Una resistencia por color."
        )
    if m == "diode":
        return f"Vf {_num(el['vf'])} V, máx. {_num(el['maxmA'])} mA. Conduce de ánodo a cátodo (franja = cátodo)."
    if m == "battery":
        return f"{_num(el['voltage'])} V, resistencia interna {_ohms(el['internalOhms'])}, {_num(el['capacitymAh'])} mAh."
    if m == "switch":
        if el.get("kind") == "push":
            return "Pulsador: a1–a2 siempre unidos y b1–b2 siempre unidos; apretar une el lado a con el lado b."
        return "Deslizante: posición 'a' une com↔a; posición 'b' une com↔b."
    if m == "buzzer":
        if el.get("kind") == "passive":
            return f"Pasivo ({_ohms(el['ohms'])}): suena SOLO con tono (buzzerTone/tone); con voltaje continuo queda en silencio."
        return f"Activo: suena a {_num(el.get('fixedHz', 0))} Hz con ≥ {_num(el['minVolts'])} V."
    if m == "motor":
        return (
            f"{_ohms(el['ohms'])}, arranca con {_num(el['minVolts'])} V, nominal {_num(el['ratedVolts'])} V, "
            f"hasta {_num(el['stallmA'])} mA: NUNCA directo a un pin; usa transistor NPN + diodo + fuente aparte."
        )
    if m == "npn":
        return (
            f"β≈{_num(el['beta'])}, Vbe {_num(el['vbe'])} V, Vce(sat) {_num(el['vceSat'])} V, máx. {_num(el['maxmA'])} mA. "
            "Interruptor de lado bajo: carga entre + y colector, emisor a GND, base al pin con 1 kΩ."
        )
    if m == "servo":
        return f"Necesita ≥ {_num(el['minVolts'])} V en V+ (usa 5V), GND común y la señal en un pin digital."
    if m == "potentiometer":
        return "Divisor de voltaje: extremos a 5V/3V3 y GND, el cursor (wiper) a un pin analógico."
    if m == "ldr":
        return (
            f"{_ohms(el['darkOhms'])} a oscuras, {_ohms(el['brightOhms'])} con mucha luz. "
            "Úsala en divisor con una resistencia de 10 kΩ y lee el punto medio con un pin analógico."
        )
    if m == "resistor":
        return "Limita la corriente. No tiene polaridad."
    if m == "bus":
        return None
    return None


def _board_pin_line(p: Json) -> str:
    bits = [f"`{p['id']}`"]
    if p.get("label") and p["label"] != p["id"]:
        bits.append(f"«{p['label']}»")
    kind = p.get("kind")
    if kind == "gpio":
        caps = [c for c in p.get("caps", []) if c != "digital"]
        if p.get("codeName"):
            bits.append(f"código {p['codeName']}")
        if caps:
            bits.append(",".join(caps))
    elif kind == "power":
        bits.append(f"alimentación {_num(p['voltage'])} V" if p.get("voltage") is not None else "alimentación")
    elif kind == "ground":
        bits.append("GND")
    else:
        bits.append(kind or "")
    if p.get("aliasOf"):
        bits.append(f"= {p['aliasOf']}")
    line = " ".join(b for b in bits if b)
    if p.get("notes"):
        line += f" ({p['notes'].strip().rstrip('.')})"
    return line


def _board_section(b: Json) -> list[str]:
    out: list[str] = []
    out.append(f"Placa {b['name']} ({b['mcu']}). {b['description']}")
    out.append(
        f"- Lógica de {_num(b['logicVoltage'])} V. Corriente por pin: recomendada {_num(b['pinCurrent']['recommendedmA'])} mA, "
        f"máx. {_num(b['pinCurrent']['maxmA'])} mA; total {_num(b['totalCurrentmA'])} mA."
    )
    out.append(
        f"- ADC de {_num(b['adc']['bits'])} bits (0..{_num(b['adc']['maxValue'])} hasta {_num(b['adc']['vref'])} V). "
        f"PWM 0..{_num(b['pwm']['maxValue'])} a {_num(b['pwm']['freqHz'])} Hz. Serial a {_num(b['serial']['baud'])} baudios."
    )
    rails = "; ".join(f"`{r['pin']}` {_num(r['volts'])} V (máx. {_num(r['maxmA'])} mA)" for r in b["supply"]["rails"])
    out.append(f"- Fuentes (alimentadas por USB): {rails}.")
    if b.get("onboard"):
        out.append("- Integrado: " + "; ".join(f"{o['label']} en `{o['pin']}`" for o in b["onboard"]) + ".")
    for c in b.get("conflicts", []):
        out.append(f"- Ojo: {c['message']}")
    buses = [g for g in b.get("internalBuses", []) if len(g) > 1]
    if buses:
        out.append("- Unidos en la placa: " + "; ".join(" = ".join(g) for g in buses) + ".")
    contact = "zócalos hembra (las patas se pueden enchufar directo)" if b["headerContact"] == "female" else "pines macho (se inserta en la protoboard)"
    out.append(f"- Conectores: {contact}.")
    headers: dict[str, list[Json]] = {}
    for p in b["pins"]:
        headers.setdefault(p.get("header", "?"), []).append(p)
    out.append("- Pines (id para PinRef `<idPlaca>.<id>` y para el IR):")
    for h, pins in headers.items():
        out.append(f"  - {h}: " + "; ".join(_board_pin_line(p) for p in pins))
    return out


def render_parts_catalog(parts: list[Json], boards: dict[str, Json]) -> str:
    lines: list[str] = []
    for d in parts:
        cat = CATEGORY_ES.get(d.get("category", ""), d.get("category", ""))
        meta = [f"categoría {cat}", f"ids {d['idPrefix']}1, {d['idPrefix']}2…"]
        if d.get("kitQty"):
            meta.append(f"en el kit: {d['kitQty']}")
        if d.get("generator") != "breadboard-half":
            meta.append("va en la protoboard" if d.get("breadboard", {}).get("insertable") else "va fuera de la protoboard")
        if d.get("interactive"):
            meta.append(f"interactivo: {d['interactive']}")
        lines.append(f"### `{d['type']}` — {d['name']} ({'; '.join(meta)})")
        edu = d.get("education", {})
        if edu.get("summary"):
            lines.append(edu["summary"])
        el = d.get("electrical", {})
        if d.get("generator") == "board-profile" and d.get("board") in boards:
            lines.extend(_board_section(boards[d["board"]]))
        elif d.get("generator") == "breadboard-half":
            lines.append("- Agujeros `a1`..`j30` y rieles `T+`/`T-`/`B+`/`B-` (ver convenciones de la protoboard).")
        else:
            if d.get("pins"):
                pins = []
                for p in d["pins"]:
                    hint = f", {p['hint'].lower()}" if p.get("hint") else ""
                    pins.append(f"`{p['id']}` {p['label']}{hint}")
                lines.append("- Pines: " + "; ".join(pins) + ".")
            if d.get("signalPins"):
                lines.append("- Pines de señal (van a la placa): " + ", ".join(f"`{s}`" for s in d["signalPins"]) + ".")
        if d.get("props"):
            lines.append("- Props: " + "; ".join(_prop_line(p) for p in d["props"]) + ".")
        el_line = _electrical_line(el)
        if el_line:
            lines.append(f"- Eléctrico: {el_line}")
        if d.get("blocks"):
            lines.append("- Bloques: " + ", ".join(f"`{b}`" for b in d["blocks"]) + ".")
        for w in edu.get("warnings", []) or []:
            lines.append(f"- ⚠ {w}")
        tips = edu.get("tips", []) or []
        if tips:
            lines.append("- Tips: " + " ".join(tips))
        lines.append("")
    return "\n".join(lines).strip()


def render_examples(examples: list[Json]) -> str:
    out = []
    for e in examples:
        board = e.get("board") or "sin placa"
        out.append(f"- `{e['id']}` — {e['name']} ({board}, {e.get('level', '')}): {e['description']}")
    return "\n".join(out)


def tools_for_api(tools: list[Json]) -> list[Json]:
    """Tool definitions passed to Claude: verbatim + eager input streaming."""
    return [{**t, "eager_input_streaming": True} for t in tools]
