#!/usr/bin/env bash
# From your laptop, at the repo root: copy gpu/ to the box and run up.sh there. One command.
#   gpu/deploy.sh [--restart]        (GPU_HOST overrides the host, default 172.16.0.204)
set -euo pipefail
HOST="${GPU_HOST:-172.16.0.204}"
cd "$(dirname "$0")"
ssh "$HOST" 'mkdir -p ~/sup/gpu'
rsync -az --delete --exclude '*.pyc' ./ "$HOST:sup/gpu/"
ssh "$HOST" "bash ~/sup/gpu/up.sh ${1:-}"
