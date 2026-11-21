"""training/results/*.json → training/results/SUMMARY.md (the before/after table for the pitch).

python training/summary.py
"""

from __future__ import annotations

import json
from pathlib import Path

RES = Path(__file__).resolve().parent / "results"


def pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.1f} %"


def main() -> None:
    lines = ["# Fine-tuning: antes vs. después", ""]
    y = RES / "yolo.json"
    if y.exists():
        d = json.loads(y.read_text())
        lines += [
            f"## Detector (YOLO) — {d['test_images']} imágenes de test, sesiones no vistas",
            "",
            "| Modelo | mAP50 | mAP50-95 | ms/img |",
            "|---|---|---|---|",
        ]
        lines += [f"| {r['model']} | {r['map50']:.3f} | {r['map']:.3f} | {r['ms']:.1f} |" for r in d["rows"]]
        lines.append("")
    rows = [(n, RES / f"vlm_{n}.json") for n in ("base", "lora")]
    rows = [(n, json.loads(p.read_text())) for n, p in rows if p.exists()]
    if rows:
        n_test = rows[0][1]["n"]
        lines += [
            f"## Juez visual (Qwen3-VL-8B) — {n_test} ejemplos de test, sesiones no vistas",
            "",
            "| Métrica | " + " | ".join("Base" if n == "base" else "LoRA propia" for n, _ in rows) + " |",
            "|---|" + "---|" * len(rows),
        ]
        metrics = [
            ("Accuracy del estado (ok / error / incierto)", lambda m: pct(m["acc_estado"])),
            ("F1 de detección de errores", lambda m: f"{m['f1_error']:.3f}"),
            ("F1 macro por tipo de error", lambda m: f"{m['macro_f1_tipo']:.3f}"),
            ("JSON válido", lambda m: pct(m["valid_json"])),
            ("JSON coherente", lambda m: pct(m["consistent_json"])),
            ("Falsas alarmas ante una sospecha falsa", lambda m: pct(m["false_alarm_on_false_suspicion"])),
            ("Latencia p50 / p95", lambda m: f"{m['p50_ms']:.0f} / {m['p95_ms']:.0f} ms"),
        ]
        for label, f in metrics:
            lines.append(f"| {label} | " + " | ".join(f(m) for _, m in rows) + " |")
        lines.append("")
    if len(lines) == 2:
        lines.append("_Todavía no hay resultados: corre training/yolo/eval.py y training/vlm/eval.py._")
    out = RES / "SUMMARY.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print(out.read_text())


if __name__ == "__main__":
    main()
