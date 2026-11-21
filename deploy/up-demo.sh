#!/usr/bin/env bash
# From your laptop: (re)deploy the public demo on the 5090 box and print its link. One command (D-015).
#   GPU5090=root@<host> GPU5090_PORT=<ssh port> deploy/up-demo.sh           build web, ship, restart server
#   … deploy/up-demo.sh --new-url    also restart the quick tunnel (gets a NEW *.trycloudflare.com URL)
#   … deploy/up-demo.sh --url        only print the current link (and check it answers)
# The box address is in the team chat, never in git. vLLM must already be up (gpu/up-5090.sh); this script
# never starts, stops or restarts it. Details: deploy/README.md.
set -euo pipefail
: "${GPU5090:?set GPU5090=root@<host> (ask the team)}"
MODE="${1:-deploy}"
case "$MODE" in deploy|--new-url|--url) ;; *) echo "usage: $0 [--new-url|--url]" >&2; exit 2 ;; esac
SSH=(ssh -p "${GPU5090_PORT:-22}" "$GPU5090")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

public_url() {
  "${SSH[@]}" 'set -a; . ~/sup/demo.env; set +a
    if [ -n "${SUP_TUNNEL_URL:-}" ]; then echo "$SUP_TUNNEL_URL"
    else grep -o "https://[a-z0-9-]*\.trycloudflare\.com" ~/sup/logs/tunnel.log 2>/dev/null | tail -1; fi'
}

check_public() {  # $1 = URL; the tunnel can take a few seconds to route after cloudflared starts
  local url="$1" i
  for i in $(seq 30); do
    if curl -fsS --max-time 10 "$url/api/health" >/dev/null 2>&1 && curl -fsS --max-time 10 "$url/" | grep -q '<div id="root">'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

if [ "$MODE" != --url ]; then
  echo "▶ building web/"
  (cd "$ROOT/web" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)

  echo "▶ shipping code to ~/sup/app"
  rev="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- contracts server tasks deploy web training/controller/weights || echo -dirty)"
  "${SSH[@]}" 'rm -rf ~/sup/app.new && mkdir -p ~/sup/app.new ~/sup/logs ~/sup/venvs'
  # Tracked + untracked-but-not-ignored files (no .venv, node_modules, .env), plus the fresh web build. The box has no rsync or git.
  (cd "$ROOT" && { git ls-files -z --cached --others --exclude-standard contracts server tasks deploy training/controller/weights; find web/dist -type f -print0; } \
    | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf -) | "${SSH[@]}" "tar -xf - -C ~/sup/app.new && echo $rev > ~/sup/app.new/REVISION"

  echo "▶ installing on the box"
  "${SSH[@]}" "MODE=$MODE bash -s" <<'REMOTE'
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
rm -rf ~/sup/app && mv ~/sup/app.new ~/sup/app
if [ ! -x ~/.local/bin/cloudflared ]; then
  wget -qO ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x ~/.local/bin/cloudflared
fi
if [ ! -f ~/sup/demo.env ]; then  # defaults; edit on the box for ElevenLabs or a named tunnel (deploy/README.md)
  umask 077
  cat > ~/sup/demo.env <<'ENV'
SUP_PERCEPTION=vlm
SUP_VLM_BASE_URL=http://127.0.0.1:8001/v1
SUP_CONTROLLER=rules
SUP_VOICE=browser
ENV
fi
chmod 600 ~/sup/demo.env
(cd ~/sup/app/server && UV_PROJECT_ENVIRONMENT=~/sup/venvs/server uv sync --no-dev --frozen -q)
set -a; . ~/sup/demo.env; set +a
if [ "${SUP_PERCEPTION:-}" = vlm ] && [ "${SUP_VLM_BASE_URL:-}" = http://127.0.0.1:8001/v1 ]; then
  python3 -c 'import urllib.request as u; u.urlopen("http://127.0.0.1:8001/v1/models", timeout=5)' \
    || { echo "✘ vLLM is not answering on 127.0.0.1:8001: start it with gpu/up-5090.sh first"; exit 1; }
fi
# The server always restarts (new code); the tunnel only with --new-url, so the link survives redeploys.
tmux kill-session -t sup-demo-server 2>/dev/null || true
pkill -f "[u]vicorn --app-dir ../deploy demo_app:app" || true
sleep 1
tmux new-session -d -s sup-demo-server "bash ~/sup/app/deploy/box/run-server.sh >> ~/sup/logs/demo-server.log 2>&1"
# Also restart it when the kind changed (a named tunnel was added to or removed from demo.env).
want="quick"; [ -n "${SUP_TUNNEL_TOKEN:-}" ] && want="named"
if [ "$MODE" = --new-url ] || ! tmux has-session -t sup-demo-tunnel 2>/dev/null \
  || [ "$(cat ~/sup/tunnel.kind 2>/dev/null)" != "$want" ]; then
  echo "$want" > ~/sup/tunnel.kind
  tmux kill-session -t sup-demo-tunnel 2>/dev/null || true
  pkill -f "[c]loudflared tunnel --no-autoupdate" || true
  : > ~/sup/logs/tunnel.log  # so the URL we read back is this tunnel's
  tmux new-session -d -s sup-demo-tunnel "bash ~/sup/app/deploy/box/run-tunnel.sh >> ~/sup/logs/tunnel.log 2>&1"
fi
for i in $(seq 60); do
  python3 -c 'import urllib.request as u; u.urlopen("http://127.0.0.1:8000/api/health", timeout=3)' 2>/dev/null && break
  [ "$i" = 60 ] && { tail -30 ~/sup/logs/demo-server.log; echo "✘ demo server not up after 2 min"; exit 1; }
  sleep 2
done
echo "✔ demo server up ($(cat ~/sup/app/REVISION))"
REMOTE
fi

url=""
for i in $(seq 20); do url="$(public_url)"; [ -n "$url" ] && break; sleep 2; done
[ -n "$url" ] || { "${SSH[@]}" 'tail -20 ~/sup/logs/tunnel.log'; echo "✘ no tunnel URL in ~/sup/logs/tunnel.log"; exit 1; }
check_public "$url" || { echo "✘ $url does not answer /api/health and the web app"; exit 1; }
echo "✔ public demo: $url"
echo "  health: $(curl -fsS --max-time 10 "$url/api/health")"
