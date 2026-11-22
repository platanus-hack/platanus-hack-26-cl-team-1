# 2026-11-22 — readme-summary

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** existing shared `feat/scenario-today` checkout; no commit or PR requested.
- **Goal:** replace the hackathon README template with a human-centered Cortafuego summary, without bananas.

## Done
- Rewrote the README around the people and planning decisions behind the wildfire and evacuation simulator.
- Added the public demo, scenario controls, today's hypothetical versus historical scenario, a short technical
  overview, model limitations, local setup, documentation links and team credits.
- Removed the submission checklist, banana instruction and obsolete personal-repository deployment guide.
- Checked the description against the local app, model documentation and Makefile; all five local links/assets
  and five documented Make targets exist, and no banana rule remains. `git diff --check` passed.
- Updated only the README, this session log and the submission-status note in the backlog; preserved existing
  uncommitted work. No application tests were run because these changes are documentation-only.

## Decisions
- None; retained the existing English documentation and prevention/planning framing.

## Open / blocked
- None.

## Next
- Team review, then include the documentation in the intended release PR.
