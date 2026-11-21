# 2026-11-21 — a3-deploy

- **Who:** josecannete (+ agent, workspace A3). A3 is Alonso's item in `docs/PLAN.md`; Cote handed it to this
  workspace.
- **Branch / PRs:** `josecannete/a3-deploy-demo` → https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/29;
  `josecannete/a3-deploy-hardening` → the follow-up for #29's non-blocking review findings
- **Goal:** a public link that runs a webcam session against the 5090's vLLM, with no laptop in the loop.

## Done
- `deploy/demo_app.py`: `create_app()` + the Vite build mounted at `/`, so one process serves the page, `/api` and
  `/ws/session`. Nothing changed in `server/app/` or `web/`.
- `deploy/box/run-server.sh`, `run-tunnel.sh`: restart loops in tmux, since the box has no systemd.
  cloudflared exposes only `127.0.0.1:8000`; vLLM stays private.
- `deploy/up-demo.sh` (from a laptop): builds web, tars the code to `~/sup/app` (no rsync/git on the box),
  `uv sync` into `~/sup/venvs/server`, writes `~/sup/demo.env` (600) on first run, checks vLLM, restarts the
  server, and prints and checks the public link. `--url` prints the current link; `--new-url` restarts the
  tunnel. It never touches vLLM.
- `deploy/smoke.py`: a real session over the public WebSocket with latency percentiles.
  From Santiago: ack RTT p50 88–94 ms, frame → observation p50 ≈ 0.5 s (server perception ≈ 0.4 s), no errors.
- Headless Chrome on the public link: the page loads and the task picker lists both tasks from `/api/tasks`.

## Decisions
- Everything on the 5090, one origin behind a Cloudflare tunnel; Render dropped (→ D-015).

## Open / blocked
- The quick-tunnel URL changes whenever cloudflared restarts. A stable link needs a named tunnel: someone with
  a Cloudflare account + domain creates it and puts the token in `~/sup/demo.env`.
- No human has clicked through a live webcam on the public link yet; the smoke test covers the same WS path.
- With the whiteboard and soap test photos, every observation came back `null` (uncertain). That's perception's
  area, not deploy's.
- `SUP_VOICE=browser` for now; ElevenLabs needs the key in `~/sup/demo.env`.

## Next
- Before judging: `deploy/up-demo.sh --url`, then a webcam run on the public link.
