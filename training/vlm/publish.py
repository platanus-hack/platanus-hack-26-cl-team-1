"""Publish the LoRA adapter to Hugging Face with a model card (F8.5).

🧑 A person decides whether it is public and logs in first (`hf auth login`, their own token):
    ~/cv/venvs/train/bin/python ~/cv/app/training/vlm/publish.py --adapter ~/cv/runs/vlm/v1/adapter \
        --repo <user-or-org>/circuito-vivo-armado-qwen3vl-lora [--public]
Private by default.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CARD = """---
base_model: Qwen/Qwen3-VL-8B-Instruct
library_name: peft
license: apache-2.0
language: [es]
tags: [lora, qlora, unsloth, vision-language, electronics, breadboard, arduino]
---

# Circuito Vivo — juez de armado (LoRA para Qwen3-VL-8B-Instruct)

LoRA (r={r}, alpha={alpha}) entrenada con QLoRA 4-bit (Unsloth) sobre la parte de lenguaje de
Qwen3-VL-8B-Instruct; el encoder visual quedó congelado. La usa el **Modo Armado** de
[Circuito Vivo](https://circuito-vivo-web.onrender.com): una webcam mira una protoboard real y el modelo revisa un
paso de armado. Recibe el frame completo y un recorte 2× con los huecos esperados dibujados, y responde JSON:

```json
{{"estado": "ok|error|incierto", "tipo": "ninguno|missing|wrong_hole|led_reversed|wrong_part|wire_wrong_end|extra_part",
 "componente": "el LED rojo", "mensaje": "Ojo, el LED está al revés: la pata larga va en e7."}}
```

Datos: sesiones grabadas por el equipo durante Platanus Hack 26 (Santiago), con el mismo kit y la misma cámara. Un
operador insertó errores a propósito y los etiquetó con el teclado; el modelo nunca etiquetó sus propios datos. Test:
sesiones completas no vistas en entrenamiento.

## Resultados (test por sesión)

{results}

Servido con vLLM: `--enable-lora --lora-modules armado=<este repo>` sobre `Qwen/Qwen3-VL-8B-Instruct-FP8`.
Código: https://github.com/platanus-hack/platanus-hack-26-cl-team-1 (`training/vlm/`).
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--public", action="store_true", help="🧑 only if the team decided so")
    a = ap.parse_args()

    from huggingface_hub import HfApi

    adapter = Path(a.adapter).expanduser()
    cfg = json.loads((adapter / "adapter_config.json").read_text())
    summary = ROOT / "training/results/SUMMARY.md"
    results = summary.read_text().split("## Juez visual", 1)[-1] if summary.exists() else "_(ver SUMMARY.md)_"
    (adapter / "README.md").write_text(
        CARD.format(r=cfg.get("r"), alpha=cfg.get("lora_alpha"), results="## Juez visual" + results)
    )
    api = HfApi()
    api.create_repo(a.repo, private=not a.public, exist_ok=True, repo_type="model")
    api.upload_folder(
        folder_path=str(adapter), repo_id=a.repo, repo_type="model", commit_message="LoRA del Modo Armado"
    )
    print(f"https://huggingface.co/{a.repo}  ({'público' if a.public else 'privado'})")


if __name__ == "__main__":
    main()
