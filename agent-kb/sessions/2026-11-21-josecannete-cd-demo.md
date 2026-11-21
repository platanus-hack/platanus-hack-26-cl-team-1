# 2026-11-21 — cd-demo

- **Who:** josecannete (+ agent, workspace A3)
- **Branch / PRs:** `josecannete/cd-demo` → https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/35
- **Goal:** merged PRs reach the public demo without anyone running `deploy/up-demo.sh` by hand.

## Done
- Found why #31 (led_flashlight) wasn't on the demo: deploys were manual. The box was on `e09521d`; I redeployed `582478c` by hand.
- `.github/workflows/cd-demo.yml`: after CI passes on a push to main (`workflow_run`), it runs `deploy/up-demo.sh` for
  the tested commit; queued; skips with a warning if the secrets are missing; a pause switch at `~/sup/cd-paused` on the box.
- A key used only by CD: generated locally (kept out of the repo), its public half added to the box's
  `authorized_keys` with `restrict` and the comment `sup-demo-cd`.
- Simulated the job locally: a clean checkout of main, a fresh HOME with only the CD key + known_hosts, `StrictHostKeyChecking yes`.
  It deployed `582478c`, and the link was unchanged.
- An earlier correction to the a3-deploy log: its branch was `josecannete/a3-deploy-demo` (#29), not `josecannete/sb191`.

## Decisions
- Continuous deployment of the demo from GitHub Actions over SSH (→ D-016).

## Open / blocked
- **Needs a repo admin** to add the four secrets; Cote's account has push but not admin. Until then the job is a green no-op.

## Next
- Admin adds the secrets, then a manual "Run workflow" to confirm; `touch ~/sup/cd-paused` before judging.
