"""Evaluate the VLM judge on the held-out sessions (F8): base vs. LoRA, same request as production.

    cd ~/cv/app/vision && .venv/bin/python ../training/vlm/eval.py \
        --data ~/cv/data/vlm/v1/test.jsonl --model qwen3vl --name base
    (with the adapter served as `armado`:)  --model armado --name lora

Metrics: accuracy of `estado`, F1 per `tipo` (+ macro F1 over error kinds), rate of valid and of
self-consistent JSON, latency p50/p95 → training/results/vlm_<name>.md (+ .json for SUMMARY.md).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision"))

from vision.vlm_prompt import SCHEMA, TIPOS, parse_verdict  # noqa: E402

ERROR_KINDS = [t for t in TIPOS if t != "ninguno"]


def b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def request(rec: dict, model: str) -> dict:
    content = [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64(p)}"}} for p in rec["images"]]
    content.append({"type": "text", "text": rec["user"]})
    return {
        "model": model,
        "messages": [{"role": "system", "content": rec["system"]}, {"role": "user", "content": content}],
        "temperature": 0,
        "max_tokens": 120,
        "response_format": {"type": "json_schema", "json_schema": {"name": "veredicto", "schema": SCHEMA}},
    }


def f1(tp: int, fp: int, fn: int) -> float:
    return 0.0 if tp == 0 else 2 * tp / (2 * tp + fp + fn)


async def run(data: Path, model: str, url: str, limit: int | None) -> dict:
    recs = [json.loads(x) for x in data.read_text().splitlines() if x.strip()][:limit]
    if not recs:
        raise SystemExit(f"{data} no tiene ejemplos (¿hay al menos 3 sesiones con errores para separar test?)")
    rows = []
    async with httpx.AsyncClient(timeout=30) as c:
        for i, rec in enumerate(recs):
            t = time.perf_counter()
            try:
                r = await c.post(f"{url}/v1/chat/completions", json=request(rec, model))
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"] or ""
            except (httpx.HTTPError, KeyError) as e:
                text = f"<error {e}>"
            ms = (time.perf_counter() - t) * 1000
            raw_ok = True
            try:
                d = json.loads(text)
                consistent = not (
                    (d.get("estado") == "ok") != (d.get("tipo") == "ninguno") and d.get("estado") != "incierto"
                )
            except json.JSONDecodeError:
                raw_ok, consistent = False, False
            v = parse_verdict(text)
            rows.append(
                {
                    "id": rec["id"],
                    "gold_estado": rec["estado"],
                    "gold_tipo": rec["tipo"],
                    "suspected": rec.get("suspected"),
                    "estado": v.estado if v else "inválido",
                    "tipo": v.tipo if v else "inválido",
                    "valid": raw_ok and v is not None,
                    "consistent": consistent,
                    "ms": ms,
                    "mensaje": v.mensaje if v else text[:80],
                }
            )
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(recs)}")
    return metrics(rows)


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    acc = sum(r["estado"] == r["gold_estado"] for r in rows) / n
    per = {}
    for k in ERROR_KINDS:
        tp = sum(r["tipo"] == k and r["gold_tipo"] == k for r in rows)
        fp = sum(r["tipo"] == k and r["gold_tipo"] != k for r in rows)
        fn = sum(r["tipo"] != k and r["gold_tipo"] == k for r in rows)
        if tp + fn:
            per[k] = {"f1": f1(tp, fp, fn), "support": tp + fn}
    macro = statistics.mean(v["f1"] for v in per.values()) if per else 0.0
    # error detection as binary: did it say "error" when there was one?
    tp = sum(r["estado"] == "error" and r["gold_estado"] == "error" for r in rows)
    fp = sum(r["estado"] == "error" and r["gold_estado"] != "error" for r in rows)
    fn = sum(r["estado"] != "error" and r["gold_estado"] == "error" for r in rows)
    # sycophancy: ok frames that came with a (false) suspicion
    sus_ok = [r for r in rows if r["gold_estado"] == "ok" and r["suspected"]]
    lat = sorted(r["ms"] for r in rows)
    return {
        "n": n,
        "acc_estado": acc,
        "f1_error": f1(tp, fp, fn),
        "macro_f1_tipo": macro,
        "per_tipo": per,
        "valid_json": sum(r["valid"] for r in rows) / n,
        "consistent_json": sum(r["consistent"] for r in rows) / n,
        "false_alarm_on_false_suspicion": (sum(r["estado"] == "error" for r in sus_ok) / len(sus_ok))
        if sus_ok
        else None,
        "p50_ms": statistics.median(lat),
        "p95_ms": lat[max(0, int(len(lat) * 0.95) - 1)],
        "confusion": Counter(f"{r['gold_tipo']}→{r['tipo']}" for r in rows if r["gold_tipo"] != r["tipo"]).most_common(
            10
        ),
        "examples": rows[:5],
    }


def report(name: str, model: str, m: dict) -> str:
    pct = lambda x: "—" if x is None else f"{100 * x:.1f} %"  # noqa: E731
    lines = [
        f"# VLM `{name}` ({model})",
        "",
        f"{m['n']} ejemplos de test (sesiones no vistas en entrenamiento).",
        "",
        "| Métrica | Valor |",
        "|---|---|",
        f"| Accuracy del `estado` | {pct(m['acc_estado'])} |",
        f"| F1 de detección de errores | {m['f1_error']:.3f} |",
        f"| F1 macro por `tipo` | {m['macro_f1_tipo']:.3f} |",
        f"| JSON válido | {pct(m['valid_json'])} |",
        f"| JSON coherente (estado ↔ tipo) | {pct(m['consistent_json'])} |",
        f"| Falsas alarmas ante una sospecha falsa | {pct(m['false_alarm_on_false_suspicion'])} |",
        f"| Latencia p50 / p95 | {m['p50_ms']:.0f} / {m['p95_ms']:.0f} ms |",
        "",
        "| Tipo | F1 | Soporte |",
        "|---|---|---|",
    ]
    lines += [f"| `{k}` | {v['f1']:.3f} | {v['support']} |" for k, v in m["per_tipo"].items()]
    if m["confusion"]:
        lines += ["", "Confusiones más frecuentes: " + ", ".join(f"{k} ({n})" for k, n in m["confusion"])]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="qwen3vl")
    ap.add_argument("--name", required=True, help="base | lora")
    ap.add_argument("--url", default="http://127.0.0.1:8001")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    m = asyncio.run(run(Path(a.data), a.model, a.url, a.limit))
    out = ROOT / "training/results" / f"vlm_{a.name}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report(a.name, a.model, m))
    out.with_suffix(".json").write_text(json.dumps(m, ensure_ascii=False, indent=1, default=str))
    print(out.read_text())


if __name__ == "__main__":
    main()
