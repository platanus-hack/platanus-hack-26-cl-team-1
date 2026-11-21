#!/usr/bin/env bash
# vLLM (OpenAI-compatible) serving Qwen3-VL for the supervisor's perception, on 127.0.0.1:8001.
# Reuses the venv and weights the previous project installed (~/cv/venvs/vllm, ~/.cache/huggingface).
# Env (from ~/sup/env): SUP_VLM_API_KEY (required: the tunnel makes this port public),
#   VLM_MODEL (checkpoint), VLM_SERVED (name clients use), VLM_GPU_UTIL, VLM_LORA (<path> → served as "<VLM_SERVED>-lora").
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
: "${SUP_VLM_API_KEY:?set SUP_VLM_API_KEY in ~/sup/env (up.sh creates one)}"
MODEL="${VLM_MODEL:-Qwen/Qwen3-VL-8B-Instruct-FP8}"
SERVED="${VLM_SERVED:-qwen3-vl-8b-fp8}"
args=(serve "$MODEL" --host 127.0.0.1 --port 8001 --served-model-name "$SERVED"
  --api-key "$SUP_VLM_API_KEY"
  --gpu-memory-utilization "${VLM_GPU_UTIL:-0.62}" --max-model-len 8192
  --limit-mm-per-prompt '{"image":2}' --max-num-seqs 4)
if [ -n "${VLM_LORA:-}" ]; then
  args+=(--enable-lora --max-lora-rank 16 --lora-modules "$SERVED-lora=$VLM_LORA")
fi
exec "$HOME/cv/venvs/vllm/bin/vllm" "${args[@]}"
