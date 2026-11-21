# Backlog

Owner in brackets once someone takes an item. Blocks refer to the plan in `docs/VISION.md`.

## Now (block 1 · foundations, until ~14:00)
- [ ] Pick the exact demo task in the robotics-assembly direction once the contact's input arrives (candidates in `docs/VISION.md`). [Anaís + team]
- [ ] Get the contact's testimonial (text, name, role, photo) with explicit consent to publish it; keep it out of the repo until then. [Anaís]
- [ ] Confirm `docs/STACK.md`; create the skeleton (web + server) on top of `contracts/`, with `make dev` / `make test`. []
- [ ] Action ontology v0 for assembly / robotics (start from `shared/parts/*.json` at `2e9da7c`) (format: `contracts/examples/ontology.*.json`). [Alonso]
- [ ] Claude prompt that generates a task from a description, validated with `Task` + `check_against`; first task in `tasks/`. [Alonso]
- [ ] Bring the GPU server up again for the new repo (vLLM + Qwen3-VL-8B FP8, tunnel); reuse `deploy/vision/` from `2e9da7c`. [Cote]
- [ ] ElevenLabs: pick a Spanish voice; a streaming TTS call working from the server. [Alonso]
- [ ] Close PR #8 (superseded by the pivot) and decide whether to turn off the old Render services. [Alonso]
- [ ] Add the `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL`) repo secret for the agent reviews; a repo admin enables "Allow auto-merge" and protects `main` (PR required, 0 approvals, required checks `CI OK` + `Agent reviews OK`, no force-push). []
- [ ] Add CI jobs (`server`, `web`) to `ci-ok.needs` as each folder lands. []

## Next (block 2 · vertical slice, until ~18:00)
- [ ] Session WebSocket server per `contracts.protocol`: frames + `hello` in; `ready` / `state` / `issue` / `say` out. Port `vision/vision/session.py`. [Alonso]
- [ ] M_VL call: frames + task context → `VlmOutput` via `parse_vlm_output`, on events, ≤1 in flight. [Cote]
- [ ] Rule controller on `TaskAutomaton`: `Observation` → `Decision` (advance / mistake / reminder). [Cote]
- [ ] Voice with anti-spam (port `speaker.py` + `audioQueue.ts`, swap Kokoro for ElevenLabs). [Alonso]
- [ ] Web UI: task picker, source toggle (sim / webcam), live checklist, subtitles, debug overlay; port `frontend/src/assembly/*`. [Anaís]

## Later (blocks 3–5)
- [ ] Symbolic simulator on `TaskAutomaton`: `Trajectory` records with injected mistakes + perception noise. [Anaís]
- [ ] Visual simulator: Runway clips per (step, correct / mistake) + `ClipRecord` manifest. [Anaís]
- [ ] Label sim clips (Gemini or Claude as teacher); eval set split by run.
- [ ] Learned controller from scratch; table rules vs learned under noise. [Cote]
- [ ] [Cote] M_VL eval base vs fine-tuned (QLoRA pipeline from `training/vlm/` at `2e9da7c`).
- [ ] Demo rehearsal ×3, backup video, `platanus-hack-project.jsonc`, `project-description.md`, README.

## Done
- [x] Contracts package (`contracts/`, `docs/CONTRACTS.md`), ownership (D-008, D-009).
- [x] CI (`CI OK`) and two-agent review (`Agent reviews OK`), auto-merge, review guide, PR template, stack proposal (D-006, D-007).
- [x] Pivot docs: `docs/VISION.md`, `docs/RESEARCH.md`, `docs/LEGACY.md`, `CLAUDE.md`, agent-kb; old code removed (D-001…D-005).
