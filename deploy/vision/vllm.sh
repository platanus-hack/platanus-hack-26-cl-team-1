#!/usr/bin/env bash
# vLLM (OpenAI-compatible) for the Modo Armado VLM. Local only: 127.0.0.1:8001.
# VLM_MODEL overrides the checkpoint (e.g. the merged fine-tuned model); VLM_LORA=<path> serves a LoRA on top.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
MODEL="${VLM_MODEL:-Qwen/Qwen3-VL-8B-Instruct-FP8}"
args=(serve "$MODEL" --host 127.0.0.1 --port 8001 --served-model-name qwen3vl
  --gpu-memory-utilization "${VLM_GPU_UTIL:-0.62}" --max-model-len 8192
  --limit-mm-per-prompt '{"image":2}' --max-num-seqs 4)
if [ -n "${VLM_LORA:-}" ]; then
  args+=(--enable-lora --max-lora-rank 16 --lora-modules "armado=$VLM_LORA")
fi
exec "$HOME/cv/venvs/vllm/bin/vllm" "${args[@]}"
