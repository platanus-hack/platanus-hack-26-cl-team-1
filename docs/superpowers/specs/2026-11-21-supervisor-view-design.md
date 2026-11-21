# Supervisor view (design, 2026-11-21)

Approved by Anaís on 2026-11-21. Small change, web only (`web/`).

## Intent

The demo: someone builds a flashlight on a breadboard under an iPhone pointed straight down, hands in
shot. The supervisor watches, ticks the checklist, and talks. Midway they put the LED in backwards
on purpose, and the supervisor warns them out loud: that's the "wow". The models (video → text,
controller) are fine-tuned on real videos of this same build; this page is the live front end.

## Goals

- A `/supervisor` page: pick the task, pick the camera (the iPhone via Continuity Camera in Chrome on
  the demo Mac), stream frames to the session server, render the checklist, subtitles, correction
  banner and debug view, and play the supervisor's voice.
- Works when the web is a static site on Render and the session server sits on the GPU box behind a
  public tunnel.

## Non-goals

- The simulator page (practice / recorder modes): later plan.
- The flashlight task itself: Alonso's (`tasks/`); a handoff note goes in `docs/flashlight-task.md`.
- Server, tunnel, CORS, `render.yaml`: not in `web/`; listed in the PR as what others must do.
- No contract change.

## Anti-goals

- Hiding a broken connection mid-demo (no silent auto-reconnect).
- Distorting the frames the model sees (the iPhone is 16:9; never squeeze to 4:3).

## Approaches considered

- **Extend the existing single page into `/supervisor` (picked).** It already streams frames over
  the WebSocket, renders checklist/subtitles/debug and plays `say` audio with `cancel_say`.
- WebRTC or a new framework: rebuilds what works, more moving parts for the same result. Rejected.

## Design

1. **Routing.** A tiny router on `location.pathname` (no dependency): `/supervisor` renders the
   supervisor page; `/` redirects there (`history.replaceState`); unknown paths show a "no existe"
   message with a link. Render needs a rewrite `/* → /index.html` (deploy owner).
2. **Server address.** One helper gives the server's base: `?server=` (existing override) >
   `VITE_SERVER_URL` (build-time, set on Render to the tunnel) > same origin. Both `/api/tasks`
   (http/https) and `/ws/session` (ws/wss) derive from it.
3. **Camera.** `enumerateDevices()` after permission; a `<select>` of video inputs; the chosen
   `deviceId` remembered in `localStorage` (wrapped in try/catch; falls back to the default camera
   if the saved one is gone, and says so in the status).
4. **Frames.** The capture canvas takes the video's real aspect ratio, scaled so the long side is at
   most 640 px (no stretching). FPS stays 6, JPEG 0.7, same binary framing.
5. **Session.** `hello {protocol: 1, task_id, source: "webcam", debug: true, record: false}`. Message
   handling as today (ready/state/issue/issue_clear/say/cancel_say/debug/error).
6. **Audio.** `VoicePlayer` unchanged: ElevenLabs mp3 when the server sends audio, browser
   `speechSynthesis` (es-CL) otherwise. "Empezar" is the user gesture that unlocks audio in Chrome.
7. **Connection loss.** A clear red status with the reason and a "Reconectar" button that restarts
   the session with the same task and camera. No automatic reconnect.
8. **Layout (UI copy in Spanish).** Large camera view; checklist on the side; large subtitles under
   it; red banner for the current correction; a visible "Depurar" toggle (key D still works) for the
   debug JSON.
9. **Tests (vitest).** The server-base helper (precedence, http→ws mapping, trailing slashes) and the
   frame-size function (aspect kept, long side ≤ 640, no upscaling).

## Left to the builder

File split inside `web/src/`, exact CSS, and copy wording.

## Others must do (listed in the PR)

- A tunnel to the session server (`:8000`) on the GPU box (today's tunnel points at vLLM `:8001`).
- Add the Render origin to `SUP_CORS_ORIGINS`.
- Render static site with `VITE_SERVER_URL` and the SPA rewrite.
