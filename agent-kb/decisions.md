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
- **Context:** three people plus parallel agents; ~18 h left. A heavier protocol (per-file decisions, generated index,
  validators) costs more than it returns here.
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

### D-006 — CI with one aggregate check, and two agent reviewers on every PR (2026-11-21)
- **Context:** several people and agents push PRs in parallel overnight; nobody has time to review everything,
  and the owner wants review automated from the start. A private repo already runs this setup.
- **Decision:** `.github/workflows/ci.yml` runs every job and `CI OK` aggregates them (a new job is added to
  `ci-ok.needs`). `.github/workflows/code-review.yml` runs `claude-haiku-5-5` and `claude-sonnet-5-5`
  independently on `pull_request_target`, against `docs/PR_REVIEW_FOCUS.md` from the base branch, with read-only
  tools and structured output that `scripts/ci/format_review.py` validates before posting a `COMMENT` review.
  A blocking finding fails that reviewer; `Agent reviews OK` aggregates both. Drafts, bots, forks and
  agent-kb-only PRs are not reviewed. `skip-agent-review` label + re-run is the escape hatch; 8 reviews per
  reviewer per PR at most. Runs on GitHub-hosted ubuntu runners.
- **Consequences:** needs the `ANTHROPIC_API_KEY` secret (+ `ANTHROPIC_BASE_URL` for the hackathon proxy) or
  `CLAUDE_CODE_OAUTH_TOKEN`. The checks are advisory until a repo admin makes `CI OK` and `Agent reviews OK`
  required on `main`. Auto-merge: D-007.

### D-007 — Agent-approved PRs merge themselves (2026-11-21)
- **Context:** the owner wants a PR to merge once CI and both agent reviews pass, with no manual step. A real
  GitHub approval doesn't fit: both agents post as `github-actions[bot]`, where only the latest review counts,
  and it would mean letting Actions approve PRs. Same reasoning as in that private repo.
- **Decision:** the agents approve through the required check `Agent reviews OK`. `.github/workflows/auto-merge.yml`
  arms squash auto-merge on every same-repo, non-draft, human-authored PR to `main`, and only when GitHub reports
  the PR as `BLOCKED` (required checks pending), so it can never merge an unprotected PR at once. `main`'s
  protection: PR required, **0 approvals**, required checks `CI OK` and `Agent reviews OK`, no force-push or deletion.
- **Consequences:** code reaches `main` with no human reading it; the guide's definition of `blocking` is what holds
  the merge. Drafts are how to hold a PR. Needs a repo admin to enable "Allow auto-merge" and set the protection
  (until then the workflow refuses to arm). Merges made with `GITHUB_TOKEN` trigger no `push` run, so CI on `main`
  only runs on the next PR or by hand (`workflow_dispatch`). Workflow changes take effect only once merged.

### D-008 — Ownership by workstream (2026-11-21)
- **Context:** three people plus agents in parallel; without owners, agents edit the same files.
- **Decision (can change):** **Alonso**: task library (ontology, recipe generation with Claude, `tasks/`) and
  the voice component. **Cote**: models: video understanding (M_VL) and the controller (rules and learned),
  their training and eval. **Anaís**: simulator (symbolic and visual) and the webcam/frame source. Contracts
  are shared: any change needs a decision entry. The session server goes to Alonso (it hosts his voice
  component, and it's a port of the old Modo Armado session he built); the web UI goes to Anaís (the webcam
  and sim-clip sources live in the page). Cote's area (two models + training) is the heaviest, so it gets nothing extra.
- **Consequences:** each owner reviews changes to their area; the table in `docs/STACK.md` § Ownership is kept current.
- **Amended 2026-11-21:** the **symbolic** simulator (`sim/symbolic/`) moves from Anaís to Cote: it exists to
  train and test the controller. Anaís keeps the visual simulator.

### D-009 — Contracts as a pydantic package; the automaton is derived from a step DAG (2026-11-21)
- **Context:** the pieces meet at six data shapes (ontology, task, perception output, controller decision,
  WebSocket messages, datasets); they need one definition that Python code imports and the web app and
  model prompts can read.
- **Decision:** `contracts/` is a standalone uv package (`pydantic` v2) imported by every Python component;
  JSON Schemas are generated into `contracts/schemas/` and CI fails when they're stale. A task's automaton is
  derived from `steps[].requires` (DAG, listed in topological order; state = set of done steps), not written
  by hand; each step is completed by exactly one action. Mistake kinds are the closed set `out_of_order`,
  `wrong_action`, `incomplete`, `repeated`. A null VLM action means "uncertain": the supervisor stays silent.
  WebSocket framing is the old Modo Armado's (little-endian `uint32 seq, uint32 t_ms` + JPEG; `uint8 len + id`
  + audio, now mp3). Spec: `docs/CONTRACTS.md`.
- **Consequences:** tasks that need loops or alternatives (do A *or* B) don't fit yet; revisit if the demo task
  needs them. The web app generates TS types from the schemas.

### D-010 — Stack confirmed; skeleton runs end to end on fakes (2026-11-21)
- **Context:** owners need a place for their code, a way to run it, and something to build against before the
  other pieces exist.
- **Decision:** `docs/STACK.md` is the stack. Skeleton: `server/` (FastAPI + uv, depends on `contracts/` by path)
  with the task library, the session WebSocket, a rule controller v0 and factories for perception and voice;
  `web/` (Vite + React + TS + pnpm) with types generated from the schemas; `tasks/<domain>/` holds the library;
  `make dev/test/check`; CI jobs `server` and `web` in `CI OK`. In-process interfaces `Perception`, `Controller`,
  `Voice` live in `contracts.interfaces`; `ScriptedPerception` and `SilentVoice` fakes are the defaults.
- **Consequences:** the full loop (browser → server → controller → subtitles + browser speech) runs with no model
  and no API keys; each owner replaces a fake behind its interface. Message and output schemas are exported in
  serialization mode so TypeScript sees `type` as required.

### D-011 — `TrajectoryEvent.observed_quality` (2026-11-21)
- **Context:** `incomplete` (right action, done badly) reaches the controller only through `VlmOutput.quality`;
  trajectories had no way to carry it, so neither controller could be trained or tested on it.
- **Decision:** `TrajectoryEvent` gets `observed_quality: Quality = "unknown"`, the quality simulated perception
  reports alongside `observed_action`/`observed_confidence`.
- **Consequences:** backward compatible (defaulted); schemas and TS types regenerated. No other consumer yet.

### D-012 — Perception: Qwen3-VL-8B FP8 on vLLM behind a keyed tunnel (2026-11-21)
- **Context:** the scripted fake must give way to a real video-language model behind `Perception`; the 3090 is
  on a private network and the server may run on a laptop.
- **Decision:** `SUP_PERCEPTION=vlm` → `VlmPerception` (`server/app/perception/vlm.py`) calls Qwen3-VL-8B-Instruct-FP8
  on vLLM (OpenAI-compatible, `openai` SDK) through a Cloudflare tunnel straight to vLLM, protected by vLLM's
  `--api-key` (in `~/sup/env` on the box, never in git). Per call: the newest frame + one ~1 s older (≤640 px),
  the task's actions with `visual_cue`/`label_es`, objects, next steps and mistakes; guided decoding with
  `vlm_output_json_schema()` narrowed to the task's actions/objects; `parse_vlm_output` still validates. ≤1 call
  in flight and ≥1.5 s between calls. A bad answer → uncertain observation; transport failures raise. GPU
  scripts live in `gpu/` (`gpu/deploy.sh`), reusing the previous project's venv and weights.
- **Consequences:** the session server stays on a laptop for development; the tunnel URL changes when a quick
  tunnel restarts (named tunnel via `SUP_TUNNEL_TOKEN` if that hurts). Resolves the M_VL proposal in §2 for the
  main model; the API labeller/fallback stays open.

### D-013 — M_C: rules baseline + a tiny GRU per task, numpy inference in the server (2026-11-21)
- **Context:** the controller must turn noisy perception into the same `Decision`s as the rules, train in
  minutes per task, and run in the server without adding torch.
- **Decision:** `RulesController` stays the baseline. The learned controller is a 1-layer GRU (64 units) per
  task, trained from scratch in `training/controller/` on `sim/symbolic` runs (noise levels mixed, split per
  run). Inputs are the perception output only (no controller state: feeding the tracked state measured worse,
  by exposure bias); outputs are P(step done) and P(mistake kind). The server restricts them to the automaton
  (a step is marked done only when legal next; mistakes attributed via `TaskAutomaton.apply`) and reuses the
  rules' texts, reminders and skip. Weights (`training/controller/weights/<task>.npz`, ~100 KB, with task
  version/actions/steps) are committed; the server runs a numpy forward pass. `SUP_CONTROLLER=rules|learned`;
  learned refuses to start when a library task lacks matching weights.
- **Consequences:** every new or changed task needs `make controller TASK=…` before running learned mode.
  Numbers in `training/results/controller.md` come only from `ctrl.evaluate`. Training tests need torch and run
  locally; CI lints the training code and tests the committed weights through the server.

## §2 Open (decide in block 1, see docs/VISION.md)

- **D-?? Demo scenario.** Direction: physical assembly in robotics (a contact who assembles robots will give a
  testimonial and a pitch framing). Exact task to pick when their input arrives; candidates in `docs/VISION.md`
  § Demo scenario. Build task-agnostic until then.
- **D-?? M_VL labeller/fallback.** Main model decided (D-012); proposal: a Gemini Flash-class API as labeller/fallback.
- **D-?? Visual simulator.** Proposal: Runway Gen-4.5 image-to-video (and Aleph for mistake variants) per step,
  starting from photos of our real setup; local Wan 2.2 as fallback. Budget to agree.
- **D-?? Deploy.** Where the web app runs for the demo (Render again, or local + tunnel to the 3090).

## §3 Superseded

_None yet._
