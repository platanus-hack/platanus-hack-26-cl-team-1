#!/usr/bin/env bash
# On the GPU box (no systemd): the demo server in a restart loop. Started by deploy/up-demo.sh in tmux.
# Settings come from ~/sup/demo.env (mode 600, never in git); see deploy/README.md.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
export UV_PROJECT_ENVIRONMENT="$HOME/sup/venvs/server"  # outside ~/sup/app, so a redeploy can wipe the code
APP="$HOME/sup/app"
set -a; . "$HOME/sup/demo.env"; set +a
export SUP_WEB_DIST="$APP/web/dist"
export PYTHONPATH="$APP/server"  # --app-dir replaces the cwd on sys.path, and demo_app imports `app`
cd "$APP/server"
while true; do
  echo "── $(date -Is) starting the demo server"
  uv run --no-dev --frozen uvicorn --app-dir ../deploy demo_app:app --host 127.0.0.1 --port 8000 --proxy-headers
  code=$?
  echo "── $(date -Is) server exited ($code); restarting in 3 s"
  sleep 3
done
