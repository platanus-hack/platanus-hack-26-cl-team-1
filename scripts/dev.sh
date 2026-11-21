#!/usr/bin/env bash
# Start the whole stack for local development:
#   redis (if not running) · FastAPI :8000 · Celery worker · Vite :5173
# Ctrl+C stops everything.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pids=()
cleanup() { echo; echo "Deteniendo…"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if ! redis-cli ping >/dev/null 2>&1; then
  echo "▶ redis"
  redis-server --save "" --appendonly no --port 6379 >/tmp/circuito-redis.log 2>&1 &
  pids+=($!)
  sleep 0.5
fi

echo "▶ api (http://127.0.0.1:8000)"
(cd "$ROOT/backend" && uv run uvicorn app.main:app --reload --port 8000) &
pids+=($!)

echo "▶ worker (celery)"
(cd "$ROOT/backend" && uv run celery -A app.compile.celery_app worker -l info -c 2) &
pids+=($!)

echo "▶ web (http://localhost:5173)"
(cd "$ROOT/frontend" && pnpm dev) &
pids+=($!)

wait
