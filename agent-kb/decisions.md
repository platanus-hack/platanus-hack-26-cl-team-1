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

## §2 Open (decide in block 1, see docs/VISION.md)

- **D-?? Demo scenario.** Proposal: a surgery-adjacent task that can be shown live with a webcam (surgical hand
  scrub / WHO hand hygiene, or sterile gloving). Surgery itself can't be demoed live and video generation may block it.
- **D-?? Repo layout and stack.** Proposal in `docs/STACK.md`.
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
