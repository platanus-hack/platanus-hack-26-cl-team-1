# Backlog

Owner in brackets once someone takes an item. Blocks refer to the plan in `docs/VISION.md`.

## Now (status 2026-11-21 16:55; critical path to the 18:00 webcam loop)
- [ ] **Confirm the demo task.** Default: `tasks/robot_assembly/servo_scout_robot.json`. New candidate with a much cheaper kit: `tasks/circuit_assembly/led_flashlight.json` (LED, 220 Ω resistor, push button, AA battery pack and jumper wires on a breadboard; weights trained). Optional: port the Arduino task from draft PR #19. [team]
- [x] **Simulator page** (D-016): `/simulador/`, C172 takeoff cockpit (`tasks/aviation/c172_takeoff.json`), practice live through the session, expert recording mocked (downloads `.webm` + `ClipRecord` JSONL). [Anaís]
- [ ] **C172 practice with the real VLM** on the 5090: v1 scored 3/16 (PR #36); v2 cockpit + cues are in, re-run `sim/cockpit/README.md` (`python -m app.perception.cases ../sim/cockpit/c172_takeoff --repeat 3`, 16 labeled cases), fix the cockpit drawing or cues for failing cases, then rehearse the 4 mistakes (`start_not_ready`, `flaps_full`, `power_with_brake`, `rotate_early`). [Anaís + Cote]
- [ ] **Kit + fixed camera on a table**, matching the demo task's parts. Nothing recorded yet. [team]
- [x] Perception on the RTX 5090 over an SSH forward (`gpu/up-5090.sh`, PR #27; D-014): 8B FP8 at p50 ≈ 0.4 s per frame, end to end through `/ws/session`. The 3090 refuses SSH (port 22), so it's parked as a fallback. [Cote]
- [x] Public demo link (A3, D-015): `deploy/up-demo.sh` runs the server + web app on the 5090 next to vLLM behind a Cloudflare quick tunnel; `--url` prints the current link. Measured from Santiago: ack RTT p50 ≈ 90 ms, frame → VLM observation p50 ≈ 0.5 s. [Cote's agent, handed off from Alonso]
- [ ] **Turn on demo CD (D-016):** a repo admin restricts the `demo` environment to `main` and adds the secrets `GPU5090`, `GPU5090_PORT`, `DEMO_SSH_KEY`, `DEMO_SSH_KNOWN_HOSTS` there (values from Cote); see `deploy/README.md` § Continuous deployment. Pause with `touch ~/sup/cd-paused` on the box before judging. [Alonso]
- [ ] **Stable demo link:** create a named Cloudflare tunnel (needs an account + domain) and put `SUP_TUNNEL_TOKEN` + `SUP_TUNNEL_URL` in `~/sup/demo.env` on the box; otherwise re-check the quick-tunnel link (`deploy/up-demo.sh --url`) before judging. [Alonso?]
- [ ] **First real webcam run** of `servo_scout_robot`: `SUP_PERCEPTION=vlm` (5090), `SUP_CONTROLLER=rules|learned`, ElevenLabs voice. Tune the single-frame "runs ahead of the steps" false `out_of_order` seen in #27's test. [Cote + whoever has the kit]
- [x] First real webcam run (hand washing, iPhone): recording + `app.perception.review` (labels, model vs oracle controller) + `app.perception.rejudge`; prompt, cues and controller fixes measured in `training/results/perception.md` (D-017). Next: a labelled run of the demo task with the new defaults (3 frames, a call every 0.75 s). [Cote]
- [ ] ElevenLabs: key in the server's env, pick a Spanish voice (`SUP_ELEVENLABS_VOICE_ID`), hear it end to end. Code is in (`app/voice/elevenlabs.py`). [Alonso]
- [ ] **Web demo screen** (N1): `/supervisor` page (camera picker for the iPhone, checklist, correction banner, subtitles, debug, voice, Reconectar) in the `feat/supervisor-view` PR; still to check on the demo Mac with the real iPhone. [Anaís]
- [ ] Get the contact's testimonial (text, name, role, photo) with explicit consent to publish it; keep it out of the repo until then. [Anaís]
- [ ] Repo admin: enable "Allow auto-merge" and protect `main` (PR required, 0 approvals, required checks `CI OK` + `Agent reviews OK`, no force-push). Until then green PRs are merged by hand. [Alonso]
- [ ] Close PR #8 (superseded by the pivot); decide on #19 (port its Arduino task + task-list tests, or close); turn off the old Render services (D-015: this project doesn't use Render). [Alonso]

## Next (tonight)
- [ ] Real recordings of the demo task on the fixed camera: correct runs + each mistake, labeled as `ClipRecord`, split per run. These replace generated video while there's no Runway key. [Anaís]
- [ ] Deploy (A3): static web for the public `deploy-url`; the server needs a public path to the 5090 (today only an SSH forward). [Alonso]

## Later (blocks 3–5)
- [ ] Visual simulator: generated clips per (step, correct / mistake) (local Wan/LTX, or Runway if a key arrives) + `ClipRecord` manifest. [Anaís]
- [ ] Label sim clips (Gemini or Claude as teacher); eval set split by run.
- [ ] Learned controller: improve mistake recall under noise (it trades recall for 4-5x fewer false alarms; see
  `training/results/controller.md`), e.g. a hybrid that lets the rules flag high-confidence mistakes. [Cote]
- [ ] Calibrate `symsim.NOISE_LEVELS` against the real M_VL's confusion matrix once it runs on sim clips. [Cote]
- [ ] VLM fine-tune: pipeline ready (`app.perception.dataset` + `training/vlm/train.py`, README); needs ≥3 more labelled runs of the demo task before training, split by session. Target: palms vs backs-style confusions. [Cote]
- [ ] Demo rehearsal ×3, backup video. Submission files are filled (name **Ojo**, logo draft, README, `project-description.md`); **`deploy-url` in `platanus-hack-project.jsonc` is still `<FILL THIS>`** until there is a stable demo link. Re-score the C172 v2 cockpit before claiming it corrects mistakes live.

## Done
- [x] Session WebSocket server per `contracts.protocol` (skeleton, D-010) with the voice queue (#22).
- [x] Symbolic simulator `sim/symbolic` (D-011 `observed_quality`), learned controller + eval + `SUP_CONTROLLER` (D-013). [Cote]
- [x] Robot assembly ontology v0, first task `servo_scout_robot`, Claude task generator (https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/17).
- [x] ElevenLabs voice + anti-spam voice queue on the client clock, `cancel_say` honored by the web player (this session's voice PR).
- [x] `VlmPerception` (`SUP_PERCEPTION=vlm`): Qwen3-VL on vLLM via the OpenAI SDK, task prompt, guided JSON, uncertain on bad answers, rate limit; `gpu/` scripts and units (D-012). [Cote] https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/21
- [x] Interfaces + fakes (`contracts.interfaces`, `contracts.fakes`); skeleton `server/` + `web/` running end to end on fakes; `make dev/test/check`; CI jobs (D-010).
- [x] Contracts package (`contracts/`, `docs/CONTRACTS.md`), ownership (D-008, D-009).
- [x] CI (`CI OK`) and two-agent review (`Agent reviews OK`), auto-merge, review guide, PR template, stack proposal (D-006, D-007).
- [x] Pivot docs: `docs/VISION.md`, `docs/RESEARCH.md`, `docs/LEGACY.md`, `CLAUDE.md`, agent-kb; old code removed (D-001…D-005).
