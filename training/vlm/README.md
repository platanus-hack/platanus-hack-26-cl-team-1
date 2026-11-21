# VLM fine-tuning (`training/vlm`)

QLoRA on Qwen3-VL-8B-Instruct so perception learns the actions of our tasks: for example, rubbing the backs of
the hands vs. the palms, which the base model confuses (`app.perception.review`). Ported from the previous
project (`2e9da7c:training/vlm/`).

**Status:** the pipeline is ready, but it has not been trained yet. One labelled session (138 calls) is too
little to train on *and* evaluate honestly, since splits are per session. Record and label at least three more
runs of the demo task first. Include the mistakes and both orders of steps that can go in either order.

## Steps

1. **Record runs** with `SUP_VLM_RECORD_DIR=<dir>` on the server (any perception settings).
2. **Label them**: `cd server && uv run python -m app.perception.review <run dir>`. Keys 1–9 and 0; a label
   holds until the next one.
3. **Build the dataset**, holding out whole sessions for the test:
   ```bash
   cd server && uv run python -m app.perception.dataset <run dir>… --out ../.context/vlm-data/v1 --test-sessions <ids>
   ```
   Every example is exactly what production sends (`prompt.build_messages`). The target is the JSON answer for
   the label, with the note first.
4. **Train on the GPU box** with vLLM stopped; QLoRA doesn't fit next to it:
   ```bash
   pkill -f "vllm serve"
   uv venv --python-preference only-managed --python 3.12 ~/sup/venvs/train
   VIRTUAL_ENV=~/sup/venvs/train uv pip install unsloth trl datasets pillow
   ~/sup/venvs/train/bin/python train.py --data ~/sup/data/vlm/v1 --out ~/sup/runs/vlm/v1
   ```
5. **Serve the adapter** on top of the FP8 base:
   `VLM_EXTRA_ARGS="--enable-lora --max-lora-rank 16 --lora-modules sup=$HOME/sup/runs/vlm/v1/adapter" ~/sup/gpu/vllm-5090.sh`.
   Then use `SUP_VLM_MODEL=sup`.
6. **Measure it** on the held-out sessions:
   `uv run python -m app.perception.rejudge <run dir> --session <test id> --out …`, with `SUP_VLM_MODEL=sup`.
   Compare with the base model on the same frames.
