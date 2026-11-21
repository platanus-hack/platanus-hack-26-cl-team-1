# 2026-11-21 — ci-agent-review

- **Who:** josecannete (+ Claude)
- **Branch / PRs:** `ci/agent-review`
- **Goal:** CI and two-agent review from the first commit, plus a stack proposal per component.

## Done
- Ported personal-fitness-app's review setup: `code-review.yml` (Haiku + Sonnet, `pull_request_target`, read-only
  tools, structured output), `scripts/ci/format_review.py` and `agent_kb_only.py` with their tests, an aggregate
  `Agent reviews OK` check. Adapted to GitHub-hosted ubuntu runners and API-key auth (hackathon proxy supported).
- `auto-merge.yml`: arms squash auto-merge on non-draft human PRs, only when the PR is `BLOCKED` by required checks.
- `ci.yml` with actionlint + tooling tests aggregated in `CI OK`.
- `docs/PR_REVIEW_FOCUS.md` rewritten for this repo (contracts, model outputs as untrusted input, async/real-time,
  eval leakage, secrets, workflow safety), PR template, `docs/STACK.md` proposal.
- Tooling tests pass locally (15). actionlint not run locally (no docker/actionlint on this Mac); CI runs it.

## Decisions
- D-006, D-007.

## Open / blocked
- Secret `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL`) not set yet → the review jobs fail until it is.
- "Allow auto-merge" is off and `main` has no protection; both need a repo admin.

## Next
- Confirm the stack, then the skeleton PR adds `server` and `web` jobs to `ci-ok.needs`.
