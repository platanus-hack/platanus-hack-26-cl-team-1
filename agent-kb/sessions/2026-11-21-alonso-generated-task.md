# 2026-11-21 — generated-task

- **Who:** alonso (+ Claude)
- **Branch / PRs:** `feat/generated-scout-task`
- **Goal:** first live run of the task generator; use its output as the robot task.

## Done
- `app.library.generate` ran live through the hackathon proxy (`claude-opus-5-5`, ~25 s, valid on the first attempt).
- Its recipe replaces the hand-written `servo_scout_robot` (same id): 10 steps, battery after all wiring, 4 mistakes.
- Library tests check that the expected tasks are present instead of the exact list.

## Decisions
- None new.

## Open / blocked
- The generated recipe connects the motor wires to the motor driver but has no step that mounts the driver.
  Fix it in the description and regenerate once the demo task is picked.

## Next
- Pick the demo task; regenerate with `--force` from a description that matches the real kit.
