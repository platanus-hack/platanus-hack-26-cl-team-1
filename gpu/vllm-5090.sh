#!/usr/bin/env bash
# vLLM on the RTX 5090 box (container, no systemd). Listens on 127.0.0.1 only; gpu/up-5090.sh forwards it.
# Env: VLM_MODEL, VLM_SERVED, VLM_PORT, VLM_GPU_UTIL (0.6 of 32 GB leaves room for a second model),
# VLM_MAX_IMAGES (frames per call, default 4), VLM_EXTRA_ARGS (e.g. --reasoning-parser qwen3).
set -euo pipefail
export VLLM_USE_DEEP_GEMM="${VLLM_USE_DEEP_GEMM:-0}"  # the box nvcc (CUDA 12) cannot JIT DeepGEMM SM120 kernels
MODEL="${VLM_MODEL:-Qwen/Qwen3-VL-8B-Instruct-FP8}"
SERVED="${VLM_SERVED:-qwen3-vl-8b-fp8}"
exec ~/sup/venvs/vllm/bin/vllm serve "$MODEL" --host 127.0.0.1 --port "${VLM_PORT:-8001}" --served-model-name "$SERVED" \
  --gpu-memory-utilization "${VLM_GPU_UTIL:-0.6}" --max-model-len 8192 \
  --limit-mm-per-prompt "{\"image\":${VLM_MAX_IMAGES:-4}}" --max-num-seqs 4 ${VLM_EXTRA_ARGS:-}
