# Supervisor View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/supervisor` page that streams the iPhone camera to the session server and renders the checklist, subtitles, corrections, debug view and the supervisor's voice; plus a handoff note for the flashlight task.

**Architecture:** Extend the existing single-page app (`web/src/App.tsx`) into a tiny path router with one page, `SupervisorPage`. Pure helpers (server address, frame size, camera choice, route) are unit-tested; the page wires them to the existing `SessionClient`, `VoicePlayer` and capture code.

**Tech Stack:** Vite + React 19 + TypeScript, vitest (node environment), pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-supervisor-view-design.md`

## Global Constraints

- Only `web/` changes for the page; no change to `contracts/` or generated `web/src/contracts/*`.
- UI copy in Spanish; code, identifiers, comments and docs in English.
- Never fail silently: every failure shows in the status line; no silent auto-reconnect.
- Frames keep the camera's aspect ratio, long side ≤ 640 px, never upscaled. FPS 6, JPEG quality 0.7, binary framing unchanged.
- `hello` = `{type: "hello", protocol: 1, task_id, source: "webcam", debug: true, record: false}`.
- Server base precedence: `?server=` > `import.meta.env.VITE_SERVER_URL` > same origin.
- `localStorage` access always inside try/catch; the page works without it.
- Conventional commits; PRs to `main`, one topic each, opened as draft until verified. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Verify with `cd web && pnpm typecheck && pnpm test && pnpm build` (what `make check` runs for web, plus `pnpm check:types`).

## Review Focus

- The iPhone disconnects mid-demo (track `ended`) → status turns red "Se desconectó la cámara" and the session stops; never frozen frames sent silently. (Task 5, manual check step.)
- The saved camera is gone (iPhone not connected today) → the default camera is used and the status says so. (Task 4 test `pickCamera` missing case.)
- `?server=` given as `wss://host/` with a trailing slash, or as `https://host` → both API and WS URLs come out right. (Task 2 tests.)
- The server is unreachable when the page loads → status explains it and "Empezar" stays disabled (no task selected). (Task 5, manual check step.)
- A camera smaller than 640 px → frames are not upscaled. (Task 3 test.)

---

### Task 1: Flashlight task handoff note (own PR)

**Files:**
- Create: `docs/flashlight-task.md`
- Modify: `agent-kb/backlog.md` (add one line under "Now", owner Alonso)

Branch `docs/flashlight-task-handoff` from `origin/main`.

- [ ] **Step 1: Write `docs/flashlight-task.md`** with these sections (English, Spanish only in quoted `*_es` drafts):
  - **Kit:** 2×AA battery holder, 220 Ω resistor, 2-pin tactile push button, half-size breadboard (rows 1–30, columns a–j, + / − rails both sides), clear-lens LED, jumper wires.
  - **Camera:** iPhone straight down over the breadboard, hands in shot.
  - **Draft steps** (hole positions are placeholders; must match how the team wires it on camera): button across the gap rows 5–7; resistor row 7 → row 12; LED long leg row 12, short leg row 13; jumper row 13 → − rail; jumper + rail → row 5; battery last (red +, black −); test: press the button, the LED lights.
  - **Demo mistake:** LED backwards. From above it's nearly invisible; the visible cue is "button pressed, LED stays dark", so the task needs the test step and a `wrong_action` mistake (e.g. action `insert_led_reversed`) with that `visual_cue`. Battery-before-wiring is caught generically (`out_of_order`).
  - **Open:** exact holes, LED color, the domain/ontology (`tasks/breadboard_circuits/` proposed), learned-controller weights (`make controller TASK=…`) before `SUP_CONTROLLER=learned`.
- [ ] **Step 2: Backlog line** under "Now": `- [ ] Flashlight demo task (`tasks/breadboard_circuits/`): draft and open points in docs/flashlight-task.md. [Alonso]`
- [ ] **Step 3: Commit and open the PR (ready, not draft: docs only)**

```bash
git add docs/flashlight-task.md agent-kb/backlog.md
git commit -m "docs: flashlight demo task handoff for the task library"
git push -u origin docs/flashlight-task-handoff
gh pr create --base main --title "docs: flashlight demo task handoff for the task library" --body "…"
```

All later tasks: branch `feat/supervisor-view` from `origin/main`; commit the spec and this plan in Task 2's commit.

### Task 2: Server address helper

**Files:**
- Create: `web/src/session/server.ts`, `web/src/session/server.test.ts`
- Modify: `web/src/session/client.ts` (drop `sessionUrl()`; default `url` comes from `serverUrls().ws`)

**Interfaces:**
- Produces: `type ServerUrls = { http: string; ws: string }` (both without trailing slash); `resolveServer(search: string, envUrl: string | undefined, loc: { protocol: string; host: string }): ServerUrls`; `serverUrls(): ServerUrls` (calls `resolveServer(location.search, import.meta.env.VITE_SERVER_URL, location)`); `apiUrl(path: string): string` = `serverUrls().http + path`; `sessionWsUrl(): string` = `serverUrls().ws + '/ws/session'`.

- [ ] **Step 1: Write the failing tests** in `server.test.ts`:

```ts
const loc = { protocol: 'http:', host: 'localhost:5173' };
expect(resolveServer('', undefined, loc)).toEqual({ http: 'http://localhost:5173', ws: 'ws://localhost:5173' });
expect(resolveServer('', undefined, { protocol: 'https:', host: 'x.onrender.com' })).toEqual({ http: 'https://x.onrender.com', ws: 'wss://x.onrender.com' });
expect(resolveServer('', 'https://t.trycloudflare.com/', loc)).toEqual({ http: 'https://t.trycloudflare.com', ws: 'wss://t.trycloudflare.com' });
expect(resolveServer('?server=wss://a.example/', 'https://env.example', loc)).toEqual({ http: 'https://a.example', ws: 'wss://a.example' });
expect(resolveServer('?server=ws://127.0.0.1:8000', undefined, loc)).toEqual({ http: 'http://127.0.0.1:8000', ws: 'ws://127.0.0.1:8000' });
expect(resolveServer('', '', loc)).toEqual({ http: 'http://localhost:5173', ws: 'ws://localhost:5173' }); // empty env = unset
expect(() => resolveServer('?server=ftp://x', undefined, loc)).toThrow(/server/);
```

- [ ] **Step 2: Run** `cd web && pnpm test -- server` → FAIL (module missing).
- [ ] **Step 3: Implement** `server.ts` per the Interfaces block: parse with `new URL`, map `ws:`↔`http:` and `wss:`↔`https:`, strip trailing `/`; any other scheme throws `Error('server URL must be http(s) or ws(s): …')`. Update `client.ts` to default `url = sessionWsUrl()` and remove `sessionUrl`.
- [ ] **Step 4: Run** `cd web && pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(web): resolve the server address from ?server, VITE_SERVER_URL or same origin` (include the spec and this plan).

### Task 3: Aspect-preserving frame capture + camera open by device

**Files:**
- Modify: `web/src/source/capture.ts`
- Create: `web/src/source/capture.test.ts`

**Interfaces:**
- Produces: `frameSize(videoWidth: number, videoHeight: number, maxSide?: number /* 640 */): { width: number; height: number }`; `openWebcam(video: HTMLVideoElement, deviceId: string | null, onEnded: () => void): Promise<() => void>` (requests `{ deviceId: { exact } }` when given, `width: { ideal: 1280 }, height: { ideal: 720 }`, calls `onEnded` once when any video track fires `ended`); `listCameras(): Promise<{ deviceId: string; label: string }[]>` (video inputs from `enumerateDevices`); `startCapture` unchanged signature. `openClip` stays until Task 5 removes its last caller and deletes it.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(frameSize(1920, 1080)).toEqual({ width: 640, height: 360 });
expect(frameSize(1080, 1920)).toEqual({ width: 360, height: 640 });
expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 });
expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 }); // never upscale
expect(frameSize(1280, 721)).toEqual({ width: 640, height: 361 }); // Math.round
expect(() => frameSize(0, 480)).toThrow(RangeError);
```

- [ ] **Step 2: Run** `cd web && pnpm test -- capture` → FAIL.
- [ ] **Step 3: Implement.** `frameSize` scales by `min(1, maxSide / max(w, h))` and rounds. In `startCapture`, on each tick read `video.videoWidth/Height`, skip the tick if either is 0, and resize the canvas only when `frameSize` changes.
- [ ] **Step 4: Run** `cd web && pnpm test && pnpm typecheck` → PASS (`App.tsx` still calls `openWebcam(video)`: pass `null, () => {}` there until Task 5 replaces it).
- [ ] **Step 5: Commit** `feat(web): keep the camera's aspect ratio in captured frames; open a chosen camera`.

### Task 4: Camera choice with a remembered device

**Files:**
- Create: `web/src/source/camera.ts`, `web/src/source/camera.test.ts`

**Interfaces:**
- Produces: `pickCamera(devices: { deviceId: string; label: string }[], saved: string | null): { deviceId: string | null; missing: boolean }`; `loadCameraId(): string | null`; `saveCameraId(id: string): void` (key `supervisor.cameraId`, both wrapped in try/catch; load returns `null` on any error).

- [ ] **Step 1: Write the failing tests:**

```ts
const devs = [{ deviceId: 'a', label: 'FaceTime' }, { deviceId: 'b', label: 'Cámara del iPhone' }];
expect(pickCamera(devs, 'b')).toEqual({ deviceId: 'b', missing: false });
expect(pickCamera(devs, 'gone')).toEqual({ deviceId: 'a', missing: true });   // saved camera not connected
expect(pickCamera(devs, null)).toEqual({ deviceId: 'a', missing: false });
expect(pickCamera([], 'b')).toEqual({ deviceId: null, missing: true });
expect(loadCameraId()).toBeNull(); // node env: no localStorage → caught
```

- [ ] **Step 2: Run** `cd web && pnpm test -- camera` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (first device is the default).
- [ ] **Step 4: Run** `cd web && pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(web): remember the chosen camera`.

### Task 5: Router and SupervisorPage

**Files:**
- Create: `web/src/router.ts`, `web/src/router.test.ts`, `web/src/pages/SupervisorPage.tsx`
- Modify: `web/src/App.tsx` (becomes the router), `web/src/app.css`

**Interfaces:**
- Consumes: `apiUrl`, `sessionWsUrl` (Task 2); `frameSize`-based `startCapture`, `openWebcam`, `listCameras` (Task 3); `pickCamera`, `loadCameraId`, `saveCameraId` (Task 4); existing `SessionClient`, `VoicePlayer`.
- Produces: `route(pathname: string): 'supervisor' | 'root' | 'not_found'` (`/supervisor` and `/supervisor/` → supervisor; `/` → root; else not_found). `App` renders `SupervisorPage` for supervisor; for root calls `history.replaceState(null, '', '/supervisor' + location.search)` then renders it (keeps `?server=`); not_found shows "Esta página no existe." with a link to `/supervisor`.

- [ ] **Step 1: Write the failing router tests** (`route('/supervisor')`, `route('/supervisor/')` → `'supervisor'`; `route('/')` → `'root'`; `route('/simulador')` → `'not_found'`).
- [ ] **Step 2: Run** `cd web && pnpm test -- router` → FAIL.
- [ ] **Step 3: Implement `router.ts`, then move `App.tsx`'s page logic into `SupervisorPage.tsx` with these changes:**
  - Remove the source select and clip input; source is always `'webcam'`.
  - Tasks: `fetch(apiUrl('/api/tasks'))`; on failure status "No pude cargar las tareas desde <http base>: ¿está corriendo el servidor?" and "Empezar" disabled while no task is selected.
  - Cameras: on mount `getUserMedia({ video: true })` then stop its tracks (permission, so labels appear), `listCameras()`, `pickCamera(list, loadCameraId())`; status "No encontré la cámara guardada; uso <label>." when `missing`; re-list on `navigator.mediaDevices` `devicechange`. A `<select>` labeled "Cámara"; changing it calls `saveCameraId`. Permission denied → status "Sin permiso para usar la cámara."
  - Start: `openWebcam(video, cameraId, onCameraEnded)`; `onCameraEnded` → `stop()` then connection state lost with reason "Se desconectó la cámara". `SessionClient` `hello` per Global Constraints.
  - Connection: state `'idle' | 'connecting' | 'live' | 'lost'`; `onClose` of the current session → `'lost'` with the reason; when `'lost'`, a red banner with the reason and a "Reconectar" button that calls `start()`. No automatic reconnect.
  - Layout: header (title "Supervisor", status), controls (task, camera, Empezar, Detener, "Depurar" toggle button with `aria-pressed`; key D still toggles), stage (large video at the frame's aspect ratio: `width: 100%`, `aspect-ratio` from the stream, no fixed 640×480; checklist on the right), red issue banner, large subtitle (≥ 28 px), debug `<pre>` when on.
  - Update `app.css` for that layout; stage stacks vertically below 900 px width.
- [ ] **Step 4: Run** `cd web && pnpm typecheck && pnpm test && pnpm build && pnpm check:types` → all PASS.
- [ ] **Step 5: Manual check** with `make dev` (scripted perception, browser voice) at `http://localhost:5173/`:
  - URL becomes `/supervisor`; tasks load; camera list shows; Empezar → checklist ticks every ~4 s, subtitles change, the browser speaks.
  - Stop the server while live → red "Reconectar" banner; restart it, click Reconectar → live again.
  - Unplug/stop the camera while live (if a second camera is available) → "Se desconectó la cámara".
  - Load the page with the server down → status names the server and Empezar is disabled.
  - Debug toggle shows observations; D key toggles too.
- [ ] **Step 6: Commit** `feat(web): supervisor page with camera picker, reconnect and demo layout`.

### Task 6: Session log, backlog, PR

**Files:**
- Create: `agent-kb/sessions/2026-11-21-chichitaocss-supervisor-view.md` (template in `agent-kb/README.md`)
- Modify: `agent-kb/backlog.md` (move/add the web UI item with the PR link)

- [ ] **Step 1: Write the session log and update the backlog.**
- [ ] **Step 2: Commit** `docs(agent-kb): supervisor view session`.
- [ ] **Step 3: Push and open a draft PR** `feat(web): supervisor page for the live demo` to `main`. Body: what the page does; how to run it; **what others must do**: a tunnel to the session server `:8000` on the GPU box (today's points at vLLM `:8001`), the Render origin in `SUP_CORS_ORIGINS`, a Render static site with `VITE_SERVER_URL` and rewrite `/* → /index.html` (Alonso, A3). Mark ready once `CI OK` is green locally-equivalent (`make check` web part passes).
