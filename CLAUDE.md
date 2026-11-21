# Supervisor (working name): Platanus Hack 26, team-1

A supervisor that watches a step-by-step task (simulated video or a real webcam), understands what
happened, predicts the next correct action from the task's recipe, and speaks: the next step, or a
correction. Trained with a simulator and fine-tuned per scenario.

- **Read first:** [docs/VISION.md](docs/VISION.md) (idea, architecture, plan), then
  [agent-kb/README.md](agent-kb/README.md) (session protocol), `agent-kb/backlog.md` (Now), and the newest file in `agent-kb/sessions/`.
- **Options and costs per component:** [docs/RESEARCH.md](docs/RESEARCH.md).
- **Previous project (Circuito Vivo):** removed from the tree, last commit `2e9da7c`. Before writing
  camera streaming, a WebSocket session, a VLM call, a TTS queue, a QLoRA pipeline or GPU-server ops, read
  [docs/LEGACY.md](docs/LEGACY.md): most of it already exists there.
- **Team:** Alonso (@alonsogm4), Anaís (@chichitaocss), José "Cote" (@josecannete).
- **Deadline:** everything on `main` by **Sun 2026-11-22 05:30 (America/Santiago)**; submission at 06:00.

## Stack and resources

- Stack per component and repo layout: [docs/STACK.md](docs/STACK.md) (proposal until confirmed).
- **GPU:** RTX 3090 24 GB at `ssh 172.16.0.204` (no sudo, no Docker GPU runtime: use `uv`). vLLM + training don't fit together.
- **APIs:** Claude (task/step generation), ElevenLabs (TTS), Runway (video generation). Keys live in
  `.env` files that are gitignored; never commit them, never put them in a service that runs untrusted code.

## Commands

```bash
python3 -I -m unittest discover -s scripts/ci/tests -t .   # CI tooling tests
```

_Add server/web commands here as soon as the skeleton exists._

## Rules

1. **PRs go straight to `main`**, small, one topic each. No stacked PRs (they bit us before: see LEGACY).
   No direct pushes to `main`. **A PR merges itself** (squash) once `CI OK` and `Agent reviews OK` are green
   (two Claude reviewers follow [docs/PR_REVIEW_FOCUS.md](docs/PR_REVIEW_FOCUS.md); D-006, D-007), so open a
   **draft** while it isn't ready, and make the PR title + body final: they become the commit.
   Fix every blocking finding or answer it on the PR; only a human adds the `skip-agent-review` label.
2. **Log the session in `agent-kb/`** before ending (see [agent-kb/README.md](agent-kb/README.md)).
   Check `agent-kb/decisions.md` before proposing anything that sounds like a decision.
3. **Contracts first.** The action ontology, `task.json` and the M_VL → M_C observation JSON are shared
   contracts: change them only with a decision entry and update every side in the same PR.
4. **UI copy in Spanish; code, identifiers and docs in English.**
5. **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, …) in commit and PR titles.
6. **No secrets in the repo**, ever, including in `agent-kb/`. **The repo is public:** don't name or quote
   private repos or other private sources (say "a private repo").

## Engineering practices (trimmed for a hackathon)

- **Never fail silently.** A model that's unsure says "uncertain" and the supervisor stays quiet; a
  broken pipeline crashes loudly. No silent clamps or fallbacks that change behavior.
- **Validate at the boundary.** Every `task.json` (from Claude) and every model output (JSON from the VLM)
  is parsed and validated where it enters; invalid → reject with a clear error.
- **Closed sets are enums**: actions, step states, mistake types. Not free strings.
- **Define once, reuse first.** Grep (and check LEGACY) before writing a helper, constant or type.
- **Measure what you claim.** Any number in the pitch (accuracy, latency) comes from a script in the repo.
- **Deal with every bot or review comment**: fix it or answer why not. Check fixes against a commit, not a reply.
- Tests where logic is non-trivial (automaton, validators, controller); no coverage theater.
