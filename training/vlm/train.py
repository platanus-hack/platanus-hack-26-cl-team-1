"""QLoRA fine-tuning of Qwen3-VL-8B-Instruct with Unsloth (F8).

    systemctl --user stop cv-vllm            # QLoRA does not fit next to vLLM
    ~/cv/venvs/train/bin/python ~/cv/app/training/vlm/train.py \
        --data ~/cv/data/vlm/v1/train.jsonl --out ~/cv/runs/vlm/v1 [--epochs 2] [--r 16]
    systemctl --user start cv-vllm

4-bit base, LoRA r=16 / alpha=32 on the language model (attention + MLP); the vision tower is
frozen. lr 2e-4, effective batch 16, checkpoint every 100 steps. Saves the adapter in <out>/adapter
(served by vLLM with VLM_LORA=<out>/adapter → model name `armado`).
Time plan B: --epochs 1 --r 8 --limit 600.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path: Path, limit: int | None) -> list[dict]:
    from PIL import Image

    recs = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    if limit:
        recs = recs[:limit]
    out = []
    for r in recs:
        imgs = [Image.open(p).convert("RGB") for p in r["images"]]
        out.append(
            {
                "messages": [
                    {"role": "system", "content": [{"type": "text", "text": r["system"]}]},
                    {
                        "role": "user",
                        "content": [{"type": "image", "image": imgs[0]}, {"type": "image", "image": imgs[1]}]
                        + [{"type": "text", "text": r["user"]}],
                    },
                    {"role": "assistant", "content": [{"type": "text", "text": r["target"]}]},
                ]
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="Qwen/Qwen3-VL-8B-Instruct")
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--r", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=32)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--max-steps", type=int, default=-1, help="smoke tests")
    a = ap.parse_args()

    from trl import SFTConfig, SFTTrainer
    from unsloth import FastVisionModel  # must be imported before transformers/trl
    from unsloth.trainer import UnslothVisionDataCollator

    model, tokenizer = FastVisionModel.from_pretrained(a.base, load_in_4bit=True, use_gradient_checkpointing="unsloth")
    model = FastVisionModel.get_peft_model(
        model,
        finetune_vision_layers=False,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=a.r,
        lora_alpha=a.alpha,
        lora_dropout=0.0,
        bias="none",
        random_state=3407,
    )
    data = load(Path(a.data), a.limit)
    print(f"{len(data)} ejemplos de entrenamiento")
    FastVisionModel.for_training(model)
    out = Path(a.out)
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        data_collator=UnslothVisionDataCollator(model, tokenizer, train_on_responses_only=True),
        train_dataset=data,
        args=SFTConfig(
            per_device_train_batch_size=a.batch,
            gradient_accumulation_steps=a.accum,
            num_train_epochs=a.epochs,
            max_steps=a.max_steps,
            learning_rate=a.lr,
            warmup_ratio=0.05,
            lr_scheduler_type="cosine",
            optim="adamw_8bit",
            weight_decay=0.01,
            logging_steps=5,
            save_steps=100,
            save_total_limit=3,
            output_dir=str(out / "checkpoints"),
            report_to="none",
            seed=3407,
            bf16=True,
            remove_unused_columns=False,
            dataset_text_field="",
            dataset_kwargs={"skip_prepare_dataset": True},
            max_length=4096,
        ),
    )
    stats = trainer.train()
    model.save_pretrained(str(out / "adapter"))
    tokenizer.save_pretrained(str(out / "adapter"))
    (out / "train_stats.json").write_text(json.dumps(stats.metrics, indent=1))
    print(f"adapter → {out / 'adapter'}\n{stats.metrics}")


if __name__ == "__main__":
    main()
