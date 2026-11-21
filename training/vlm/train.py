"""QLoRA fine-tuning of Qwen3-VL-8B-Instruct for perception, with Unsloth (ported from the previous
project at `2e9da7c`; see training/vlm/README.md).

    # on the GPU box, with vLLM stopped (QLoRA does not fit next to it)
    ~/sup/venvs/train/bin/python ~/sup/gpu/../training/vlm/train.py \
        --data ~/sup/data/vlm/v1 --out ~/sup/runs/vlm/v1 [--epochs 2] [--r 16]

The data dir comes from `server/app/perception/dataset.py`: train.jsonl rows with `system`, `user`,
`images` (paths relative to the data dir) and the JSON `target`. 4-bit base, LoRA r=16 / alpha=32 on the
language model (attention + MLP); the vision tower is frozen. Saves the adapter in <out>/adapter, which
vLLM serves on top of the FP8 base with `VLM_EXTRA_ARGS="--enable-lora --lora-modules sup=<out>/adapter"`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(data_dir: Path, limit: int | None):
    """JSONL → datasets.Dataset of plain strings (TRL 1.x wants a Dataset; PIL images inside nested
    chat messages do not survive Arrow, so images stay as paths and are opened by the collator)."""
    from datasets import Dataset

    recs = [json.loads(x) for x in (data_dir / "train.jsonl").read_text().splitlines() if x.strip()]
    for r in recs:  # images are stored relative to the data dir
        r["images"] = [str(data_dir / p) for p in r["images"]]
    if limit:
        recs = recs[:limit]
    keep = ("system", "user", "target", "images")
    return Dataset.from_list([{k: r[k] for k in keep} for r in recs])


def to_messages(r: dict) -> dict:
    from PIL import Image

    imgs = [Image.open(p).convert("RGB") for p in r["images"]]
    return {
        "messages": [
            {"role": "system", "content": [{"type": "text", "text": r["system"]}]},
            {
                "role": "user",
                "content": [{"type": "image", "image": im} for im in imgs] + [{"type": "text", "text": r["user"]}],
            },
            {"role": "assistant", "content": [{"type": "text", "text": r["target"]}]},
        ]
    }


class PathCollator:
    """Opens the images of each row and hands chat messages to Unsloth's vision collator."""

    def __init__(self, inner) -> None:
        self.inner = inner

    def __call__(self, rows: list[dict]):
        return self.inner([to_messages(r) for r in rows])


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

    from unsloth import FastVisionModel  # must be imported before transformers/trl
    from unsloth.trainer import UnslothVisionDataCollator
    from trl import SFTConfig, SFTTrainer  # noqa: I001 - after unsloth on purpose

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
    print(f"{len(data)} training examples")
    FastVisionModel.for_training(model)
    out = Path(a.out)
    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,  # TRL 1.x name
        data_collator=PathCollator(
            UnslothVisionDataCollator(
                model,
                tokenizer,
                resize="max",  # keep the frames as production sends them (≤640 px)
                train_on_responses_only=True,  # loss only on the JSON answer (Qwen ChatML turns)
                instruction_part="<|im_start|>user\n",
                response_part="<|im_start|>assistant\n",
            )
        ),
        train_dataset=data,
        args=SFTConfig(
            per_device_train_batch_size=a.batch,
            gradient_accumulation_steps=a.accum,
            num_train_epochs=a.epochs,
            max_steps=a.max_steps,
            learning_rate=a.lr,
            warmup_steps=0.05,  # float in [0, 1) = ratio of total steps (transformers 5)
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
