# Decisions

Format: `D-NNN — title (YYYY-MM-DD)` + context, decision, consequences. Superseded decisions move to §3
with a pointer to their replacement; nothing is ever deleted from §3.

## §1 In force

### D-001 — Pivot to a general step-by-step task supervisor (2026-11-21)
- **Context:** Circuito Vivo's Modo Armado was already a supervisor for one task (wiring a circuit). The
  team wants the general version: any task as a recipe, simulated or real video, a VLM, a controller, voice.
- **Decision:** build the supervisor described in `docs/VISION.md`.
- **Consequences:** the previous product stops being developed; its PR #8 (hackathon metadata) is superseded.

### D-002 — Start from an empty tree; reuse the old code through git history (2026-11-21)
- **Context:** the old code is large (500+ files) and most of it (circuit sim, Blockly, compile) is irrelevant;
  a few pieces (camera streaming, VLM serving, TTS queue, QLoRA) are directly reusable.
- **Decision:** remove everything except the hackathon files. `docs/LEGACY.md` describes the old project,
  pins its last commit `2e9da7c`, and maps what to reuse and how (`git show 2e9da7c:<path>`).
- **Consequences:** CI/CD and `render.yaml` are gone too, so pushes to `main` no longer deploy; the old Render
  services keep serving the old build until someone turns them off.

### D-003 — Lightweight agent-kb: backlog, decisions, per-session files (2026-11-21)
- **Context:** three people plus parallel agents; ~18 h left. The heavier lmm-style protocol (per-file decisions,
  generated index, validators) costs more than it returns here.
- **Decision:** `agent-kb/` with `backlog.md`, `decisions.md` and `sessions/YYYY-MM-DD-<handle>-<slug>.md`,
  plus the rules in `CLAUDE.md` (`AGENTS.md` points to it).
- **Consequences:** every session reads the backlog, recent sessions and decisions first, and logs itself at the end.

### D-004 — Docs and code in English, UI in Spanish (2026-11-21)
- **Context:** same split as before; the pitch and users are Chilean, tooling and agents work best in English.
- **Decision:** identifiers, comments, docs and agent-kb in English; every user-visible string and the voice in Spanish.
- **Consequences:** prompts that generate spoken text must ask for Spanish output.

### D-005 — Providers available: Claude for tasks, ElevenLabs for voice, own RTX 3090 (2026-11-21)
- **Context:** the team has access to the Claude API, the ElevenLabs API and the 3090 server.
- **Decision:** Claude generates and revises task recipes; ElevenLabs does TTS; heavy models (VLM, training) run on the 3090.
- **Consequences:** see `docs/RESEARCH.md` for models and costs.

## §2 Open (decide in block 1, see docs/VISION.md)

- **D-?? Demo scenario.** Proposal: a surgery-adjacent task that can be shown live with a webcam (surgical hand
  scrub / WHO hand hygiene, or sterile gloving). Surgery itself can't be demoed live and video generation may block it.
- **D-?? Repo layout and stack.** Proposal: `web/` (Vite + React + TS), `server/` (FastAPI + uv: tasks,
  controller, session WebSocket), `gpu/` (vLLM + training scripts), `tasks/` (task library JSON), `sim/`.
- **D-?? Task format.** Proposal: `task.json` = steps + objects + action vocabulary subset + automaton
  (states, legal transitions) + mistakes with corrections; validated by a JSON schema plus code checks.
- **D-?? M_VL.** Proposal: Qwen3-VL-8B FP8 on vLLM (3090) as the main model; a Gemini Flash-class API as labeller/fallback.
- **D-?? M_C.** Proposal: automaton tracker (rules) as baseline + a small model trained from scratch on simulator
  trajectories, output masked to legal actions.
- **D-?? Visual simulator.** Proposal: Runway Gen-4.5 image-to-video (and Aleph for mistake variants) per step,
  starting from photos of our real setup; local Wan 2.2 as fallback. Budget to agree.
- **D-?? Deploy.** Where the web app runs for the demo (Render again, or local + tunnel to the 3090).

## §3 Superseded

_None yet._
