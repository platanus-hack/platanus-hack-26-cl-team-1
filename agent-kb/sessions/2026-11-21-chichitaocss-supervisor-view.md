# 2026-11-21 — supervisor-view

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/supervisor-view` (this PR); `docs/flashlight-task-handoff` → https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/32
- **Goal:** the web demo screen (N1): a `/supervisor` page for the live demo with the iPhone as camera.

## Done
- Scope agreed with the team member: only the supervisor page for now; the simulator page (practice / recorder modes) is a later plan.
- Demo direction from the team: a **breadboard flashlight** (2×AA, 220 Ω, push button, LED), camera straight down with hands in shot; the on-stage mistake is the LED in backwards. The task itself is handed to the task library (PR #32, `docs/flashlight-task.md`).
- `/supervisor` page (`web/src/pages/SupervisorPage.tsx`): task and camera pickers (camera remembered per browser), frames keep the camera's aspect ratio (≤640 px, no upscaling), checklist, red correction banner, large subtitles, debug toggle (button or D), voice via the existing `VoicePlayer`; a dropped connection or camera shows a red banner with "Reconectar" (no silent auto-reconnect).
- Server address helper (`web/src/session/server.ts`): `?server=` > `VITE_SERVER_URL` > same origin, for both `/api` and `/ws` (before, `?server=` only reached the WebSocket).
- The build also writes `dist/supervisor/index.html`, so `/supervisor` survives a reload on the demo server (`deploy/demo_app.py` serves real files only).
- Design and plan: `docs/superpowers/specs/2026-11-21-supervisor-view-design.md`, `docs/superpowers/plans/2026-11-21-supervisor-view.md`.

## Decisions
- None new. The design said Render; D-015 (merged meanwhile) runs web + server from one origin on the 5090. The page works either way (same origin by default; `VITE_SERVER_URL` only matters for a separate static host).

## Open / blocked
- Not verified with the real iPhone: the Browser pane blocks cameras, so a canvas stream stood in for it. Check on the demo Mac in Chrome: the iPhone appears in "Cámara", frames are 16:9, voice plays.
- The flashlight task (PR #32) is needed before the demo; until then the page lists the existing tasks.

## Next
- Rehearse on the demo Mac with the iPhone and the flashlight task once it lands.
- Simulator page (practice / recorder) as its own plan.
