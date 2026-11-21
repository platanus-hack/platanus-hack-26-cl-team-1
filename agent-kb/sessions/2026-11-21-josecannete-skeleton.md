# 2026-11-21 — skeleton

- **Who:** josecannete (+ Claude)
- **Branch / PRs:** `josecannete/repo-state-run-v5`
- **Goal:** interfaces between owners and a skeleton everyone can build on, running end to end without models.

## Done
- `contracts.interfaces` (`Perception`, `Controller`, `Voice`, `Frame`) and `contracts.fakes` (`ScriptedPerception`,
  `SilentVoice`); schemas for messages/outputs exported in serialization mode (TS sees `type` as required).
- `server/`: task library loading `tasks/<domain>/`, `/api/tasks`, `/ws/session` wiring frames → perception →
  rule controller v0 → state/issue/say; 14 tests incl. a full scripted session over the WebSocket.
- `web/`: Vite + React + TS; generated types; session client, frame packing, webcam/clip capture; minimal UI
  (task picker, source, checklist, issue, subtitles, browser speech, debug on D); 4 tests; builds.
- `Makefile` (`install`, `dev`, `test`, `check`, `schemas`); CI jobs `server` and `web` in `CI OK`. `make check` passes.
- Pitch framing from the robotics contact recorded in `docs/VISION.md` (no personal details).

## Decisions
- D-010.

## Open / blocked
- Not tried in a real browser yet (camera permission, speech). Agent reviews still fail on the API key.

## Next
- Owners replace fakes: VLM perception (Cote), ElevenLabs voice + anti-spam queue (Alonso), real UI + sim clips (Anaís).
