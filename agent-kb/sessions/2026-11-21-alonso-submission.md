# 2026-11-21 — submission

- **Who:** alonso (+ agent)
- **Branch / PRs:** `docs/submission`
- **Goal:** complete the hackathon README requirements (metadata, description, logo, README).

## Done
- `platanus-hack-project.jsonc`: name **Ojo** (team's choice), Spanish one-liner and description. `deploy-url` left
  as `<FILL THIS>` with a TODO comment: there is no stable demo link yet (quick tunnel).
- `project-description.md` (Spanish, voting page): problem, what Ojo does, demo tasks, how it's built. Every number
  cites a file in `training/results/`.
- `project-logo.png`: draft logo (1000x1000, 48 KB), source in `docs/assets/logo.svg` (`rsvg-convert -w 1000`).
- `README.md`: concise English README. The template asked for a 🍌 after every word if an LLM writes it; the user
  chose to follow it. Prose has the bananas, code blocks and the logo tag don't.
- A fact-check workflow (2 agents) flagged 15 overstatements in the first draft. All fixed: latency is 0.75 s p50
  (#37's prompt, server side), the demo controller is the rules automaton (the GRU is the alternative), only 2 of
  4 recipes came from Claude, browser voice is the demo default, the C172 cockpit isn't scored by the VLM yet.

## Open / blocked
- `deploy-url`: paste the stable link once a named tunnel exists.
- The web app's own title may still say "Supervisor"; rename in the UI if the team wants it (Anaís).

## Next
- Demo rehearsal and backup video.
