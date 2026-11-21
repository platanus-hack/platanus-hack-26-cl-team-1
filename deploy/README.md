# Public demo (A3, D-015)

The whole demo runs on the RTX 5090 box next to vLLM. One process serves the web app, `/api/*` and
`/ws/session`, and one Cloudflare tunnel makes it public. No laptop is in the loop.

```
browser ──https/wss──▶ cloudflared (*.trycloudflare.com) ──▶ demo server 127.0.0.1:8000 ──▶ vLLM 127.0.0.1:8001
                       └─────────────────────────── all on the 5090 box ──────────────────────────────┘
```

- `deploy/demo_app.py` is `app.main.create_app()` plus the Vite build mounted at `/`. Same origin, so no CORS,
  no `?server=` and no second host.
- Only the demo server goes through the tunnel. vLLM stays on `127.0.0.1` and has no API key.
- The link has no login, and every session drives the GPU. `demo_app.py` therefore caps open sessions at
  `SUP_DEMO_MAX_SESSIONS` (default 4; `deploy/session_cap.py`). A connection takes a slot only once it sends
  its hello, which must arrive within 10 s. Extra tabs are closed with 1013 and the reason "Demo ocupada…".
- Webcam access needs HTTPS. The tunnel gives us that.

## One command

From the repo root on your laptop (needs `pnpm` and SSH to the box; its address is in the team chat, never in
git):

```bash
export GPU5090=root@<host> GPU5090_PORT=<ssh port>
gpu/up-5090.sh              # only if vLLM isn't up yet (this script never touches vLLM)
deploy/up-demo.sh           # build web/, ship the code, restart the server → prints the public link
deploy/up-demo.sh --url     # only print the current link and check it answers
deploy/up-demo.sh --new-url # also restart the tunnel (a quick tunnel gets a NEW URL)
```

What `up-demo.sh` does:
1. Runs `pnpm build` in `web/`.
2. Copies the repo's `contracts server tasks deploy training/controller/weights` and `web/dist` to `~/sup/app`.
   It tars git-tracked and untracked-but-not-ignored files (so no `.env`), because the box has no rsync or git.
   `~/sup/app/REVISION` holds the commit.
3. Installs the pinned, checksummed `cloudflared` if it isn't there yet. Runs `uv sync --no-editable` into
   `~/sup/venvs/server` while the old server still runs, so a failed install leaves the demo up.
4. Checks vLLM answers on `:8001`, and fails if it doesn't.
5. Restarts the server in tmux and waits for `/api/health`.
6. Reads the tunnel URL and checks `/api/health` and the page through it.

A plain redeploy restarts **only the server**, unless the tunnel kind changed (a named tunnel was added or
removed in `demo.env`). The tunnel keeps running, so **the link stays the same**. A
quick-tunnel URL changes only when cloudflared restarts (`--new-url`, a box reboot, or cloudflared crashing
and being restarted by its loop). If the link stops working, run `deploy/up-demo.sh --url` to get the new one.

## On the box

There's no systemd, so each process runs in a restart loop in a tmux session:

| tmux session | Script | Log |
|---|---|---|
| `sup-demo-server` | `deploy/box/run-server.sh`: uvicorn `demo_app:app` on `127.0.0.1:8000` | `~/sup/logs/demo-server.log` |
| `sup-demo-tunnel` | `deploy/box/run-tunnel.sh`: cloudflared to `127.0.0.1:8000` | `~/sup/logs/tunnel.log` |

`~/sup/demo.env` (mode 600, never in git) holds the server settings. The first deploy writes the defaults:

```bash
SUP_PERCEPTION=vlm
SUP_VLM_BASE_URL=http://127.0.0.1:8001/v1
SUP_CONTROLLER=rules          # or learned
SUP_VOICE=browser             # elevenlabs + the two lines below for server TTS
# SUP_DEMO_MAX_SESSIONS=4     # open /ws/session connections allowed at once
# ELEVENLABS_API_KEY=…
# SUP_ELEVENLABS_VOICE_ID=…
# SUP_TUNNEL_TOKEN=…          # a named Cloudflare tunnel (stable URL) instead of a quick tunnel
# SUP_TUNNEL_URL=https://…    # its public URL, so up-demo.sh can print and check it
```

Edit it on the box, then run `deploy/up-demo.sh` again. A redeploy takes the page down for a few seconds
(code swap, `uv sync`, startup), so don't redeploy while a judge is using it. cloudflared is pinned to a
version and checked against its SHA-256 (`CF_VERSION`/`CF_SHA256` in `up-demo.sh`). To stop the demo:
`tmux kill-session -t sup-demo-server; tmux kill-session -t sup-demo-tunnel`.

## Check it from outside

`deploy/smoke.py` runs a real session over the public WebSocket. It sends JPEGs at ~6 fps with debug on and
reports the round trip:

```bash
cd server && uv run python ../deploy/smoke.py https://<tunnel>.trycloudflare.com hand_hygiene_basic a.jpg b.jpg
```

Measured 2026-11-21 from Santiago over three runs (8B FP8, 20 s, 119 frames, 13–14 observations: the 1.5 s
rate limit). The ack time depends on which Cloudflare edge the quick tunnel lands on:

| | p50 | p95 |
|---|---|---|
| Frame → server ack (network + tunnel round trip) | 25–94 ms | 62–119 ms |
| Frame → VLM observation back in the client | 473–536 ms | 532–622 ms |
| Perception as measured by the server | 377–427 ms | 452–481 ms |

In the browser, open the link, pick a task, choose the webcam, and press the debug key (D) to see the
observations.

## Why not Render (D-015)

The old project put the static web app on Render and pointed it at the GPU tunnel with `?server=`. That doesn't
fit here:
- The web app fetches `/api/tasks` from its own origin, so a separate static host would need a web change.
- A quick tunnel's URL changes anyway, so a Render link would need a new `?server=` too.
- Render needs a human with the account.

A **stable link** needs a named Cloudflare tunnel (`SUP_TUNNEL_TOKEN` + `SUP_TUNNEL_URL` in `~/sup/demo.env`),
created by someone with a Cloudflare account and a domain.
