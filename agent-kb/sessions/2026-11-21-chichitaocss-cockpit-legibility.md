# 2026-11-21 — cockpit-legibility

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/cockpit-legibility` (see the PR list)
- **Goal:** act on Jose's VLM run of the C172 cockpit (PR #36: 3/16 per pass) so the model can read every step.

## Done
- Diagnosis: the model only read big, high-contrast changes (master rockers, flaps lever) and answered `null`
  (~0.95) for everything else; pixel count alone didn't explain it (LAND changed 3.8k px and was missed), so
  salience and cue wording both matter. Rotation changed ~27-41k px and was missed: a cue problem.
- Panel v2 (`web/src/simulator/c172/panel.ts`): lit ON/OFF pills on every rocker, lit state placards on
  THROTTLE (FULL/IDLE/%) and MIXTURE (RICH/CUTOFF), a color-coded FLAPS readout (0° white, 10° green, 20° amber,
  30° red), a two-color fuel selector, STARTER and PARK BRAKE annunciators, a bigger key with a lit position pill,
  a bigger tachometer, a darker propeller disc; windshield pitch shown ×1.6 (instruments stay true).
- Cues v2 (`tasks/aviation/`, ontology + task v2): every `visual_cue` / `completion_cue` names the control's
  place, color and lit text. Learned-controller weights retrained (numbers unchanged).
- Frames recaptured; `sim/cockpit/diff_cases.py` (pixel-change proxy): fuel 59 → 3142, brake 2292 → 5408, power
  with brake 762 → 3042, rotate 41.6k → 62.9k.

## Decisions
- Legibility over strict realism for the demo cockpit: lit placards and pills a real C172 doesn't have.

## Open / blocked
- Not scored by the VLM yet (no 5090 access here): Jose re-runs `python -m app.perception.cases`.
- Haiku's blocking finding on #36 (recording labels use sim time, the video wall time) is merged unfixed: next PR.

## Next
- Re-run the VLM cases; iterate on whatever still fails. Fix the recording clock.
