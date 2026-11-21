# Backlog

Owner in brackets once someone takes an item. Blocks refer to the plan in `docs/VISION.md`.

## Now (block 1 · foundations, until ~14:00)
- [ ] Decide the demo scenario (decisions §2). [team]
- [ ] Decide repo layout + stack; create the skeleton (web + server) with `make dev` / `make test` and document commands in `CLAUDE.md`. []
- [ ] Action ontology v0 (verbs, objects, params) for the demo scenario's domain. []
- [ ] `task.json` schema + validator; Claude prompt that generates a task from a description; first validated task in `tasks/`. []
- [ ] Bring the GPU server up again for the new repo (vLLM + Qwen3-VL-8B FP8, tunnel); reuse `deploy/vision/` from `2e9da7c`. []
- [ ] ElevenLabs: pick a Spanish voice; a streaming TTS call working from the server. []
- [ ] Close PR #8 (superseded by the pivot) and decide whether to turn off the old Render services. [Alonso]

## Next (block 2 · vertical slice, until ~18:00)
- [ ] Session WebSocket: browser sends frames (webcam or a sim clip played in the page) + the task; server replies with step / issue / say. Reuse `frontend/src/assembly/*` and `vision/vision/session.py`.
- [ ] M_VL call: frames + task context → observation JSON (validated), on events, ≤1 in flight.
- [ ] Automaton controller (rules): advance / mistake + correction / stuck reminder.
- [ ] Voice with anti-spam (port `speaker.py` + `audioQueue.ts`, swap Kokoro for ElevenLabs).
- [ ] UI: task picker, source toggle (sim / webcam), live checklist, subtitles, debug overlay.

## Later (blocks 3–5)
- [ ] Symbolic simulator: trajectories with injected mistakes + perception noise.
- [ ] Visual simulator: Runway clips per (step, correct / mistake), starting from photos of the real setup.
- [ ] Label sim clips (Gemini or Claude as teacher); eval set split by run.
- [ ] Learned controller from scratch; table rules vs learned under noise.
- [ ] M_VL eval base vs fine-tuned (QLoRA pipeline from `training/vlm/` at `2e9da7c`).
- [ ] Demo rehearsal ×3, backup video, `platanus-hack-project.jsonc`, `project-description.md`, README.

## Done
- [x] Pivot docs: `docs/VISION.md`, `docs/RESEARCH.md`, `docs/LEGACY.md`, `CLAUDE.md`, agent-kb; old code removed (D-001…D-005).
