# Backlog

Owner in brackets once someone takes an item. Blocks refer to the plan in `docs/VISION.md`.

## Now (block 1 · foundations, until ~14:00)
- [ ] Pick the exact demo task in the robotics-assembly direction once the contact's input arrives (candidates in `docs/VISION.md`). [Anaís + team]
- [ ] Get the contact's testimonial (text, name, role, photo) with explicit consent to publish it; keep it out of the repo until then. [Anaís]
- [ ] Bring the GPU server up again for the new repo: scripts ready in `gpu/` (`gpu/deploy.sh`); **blocked: `ssh 172.16.0.204` refuses port 22** (host pings). Then run it, record latency p50/p95 with `app.perception.bench`, and judge webcam frames end to end. [Cote]
- [x] Local prototype on the Mac: Ollama + Qwen3-VL-2B runs through `VlmPerception` (about 2–10 s per frame on an M1 with 8 GB; too inaccurate to judge); `gpu/README.md` § Local on a Mac. [Cote]
- [ ] ElevenLabs: get the API key into the server's env, pick a Spanish voice (`SUP_ELEVENLABS_VOICE_ID`), hear it end to end in the browser. Code is in (`app/voice/elevenlabs.py`). [Alonso]
- [ ] Run the task generator live once a key is available (`servo_scout_robot` was hand-written to the generator's rules); regenerate or refine the demo task once the scenario is picked. [Alonso]
- [ ] Close PR #8 (superseded by the pivot) and decide whether to turn off the old Render services. [Alonso]
- [ ] Add the `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL`) repo secret for the agent reviews; a repo admin enables "Allow auto-merge" and protects `main` (PR required, 0 approvals, required checks `CI OK` + `Agent reviews OK`, no force-push). []

## Next (block 2 · vertical slice, until ~18:00)
- [ ] Session WebSocket server per `contracts.protocol`: frames + `hello` in; `ready` / `state` / `issue` / `say` out. Port `vision/vision/session.py`. [Alonso]
- [ ] Web UI: task picker, source toggle (sim / webcam), live checklist, subtitles, debug overlay; port `frontend/src/assembly/*`. [Anaís]

## Later (blocks 3–5)
- [ ] Visual simulator: Runway clips per (step, correct / mistake) + `ClipRecord` manifest. [Anaís]
- [ ] Label sim clips (Gemini or Claude as teacher); eval set split by run.
- [ ] Learned controller: improve mistake recall under noise (it trades recall for 4-5x fewer false alarms; see
  `training/results/controller.md`), e.g. a hybrid that lets the rules flag high-confidence mistakes. [Cote]
- [ ] Calibrate `symsim.NOISE_LEVELS` against the real M_VL's confusion matrix once it runs on sim clips. [Cote]
- [ ] [Cote] M_VL eval base vs fine-tuned (QLoRA pipeline from `training/vlm/` at `2e9da7c`).
- [ ] Demo rehearsal ×3, backup video, `platanus-hack-project.jsonc`, `project-description.md`, README.

## Done
- [x] Symbolic simulator `sim/symbolic` (D-011 `observed_quality`), learned controller + eval + `SUP_CONTROLLER` (D-013). [Cote]
- [x] Robot assembly ontology v0, first task `servo_scout_robot`, Claude task generator (https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/17).
- [x] ElevenLabs voice + anti-spam voice queue on the client clock, `cancel_say` honored by the web player (this session's voice PR).
- [x] `VlmPerception` (`SUP_PERCEPTION=vlm`): Qwen3-VL on vLLM via the OpenAI SDK, task prompt, guided JSON, uncertain on bad answers, rate limit; `gpu/` scripts and units (D-012). [Cote] https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/21
- [x] Interfaces + fakes (`contracts.interfaces`, `contracts.fakes`); skeleton `server/` + `web/` running end to end on fakes; `make dev/test/check`; CI jobs (D-010).
- [x] Contracts package (`contracts/`, `docs/CONTRACTS.md`), ownership (D-008, D-009).
- [x] CI (`CI OK`) and two-agent review (`Agent reviews OK`), auto-merge, review guide, PR template, stack proposal (D-006, D-007).
- [x] Pivot docs: `docs/VISION.md`, `docs/RESEARCH.md`, `docs/LEGACY.md`, `CLAUDE.md`, agent-kb; old code removed (D-001…D-005).
