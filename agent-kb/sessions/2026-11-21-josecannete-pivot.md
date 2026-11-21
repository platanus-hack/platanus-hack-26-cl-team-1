# 2026-11-21 — pivot

- **Who:** josecannete (+ Claude)
- **Branch / PRs:** `josecannete/vsr37`
- **Goal:** move the repo from Circuito Vivo to the new task-supervisor project, with context for agents.

## Done
- Surveyed the old repo's state: the app was live on Render at `2e9da7c`; Modo Armado F0–F6/F9 built, F4–F8
  (data, fine-tuning) blocked on the physical kit; hackathon files unfilled (draft PR #8).
- Looked at agent-kb setups in two other repos (lmm's v5 protocol, personal-fitness-app's lightweight one)
  and an engineering-practice note; adopted the lightweight version (D-003).
- Wrote `docs/VISION.md` (idea, whiteboard transcription, architecture, plan to the deadline),
  `docs/RESEARCH.md` (simulator / VLM / controller / TTS options with prices and sources),
  `docs/LEGACY.md` (old project + reuse map at `2e9da7c`), `CLAUDE.md`, `AGENTS.md`, agent-kb.
- Removed all old code, CI/CD and deploy config from the tree (D-002). Whiteboard photos in `docs/assets/`.

## Decisions
- D-001 to D-005.

## Open / blocked
- Demo scenario, repo layout, task format, M_VL, M_C, visual simulator, deploy: proposals in decisions §2.
- Whiteboard item 7 says "speech-to-text"; assumed text-to-speech. Confirm.

## Next
- Block 1 of the plan (backlog "Now").
