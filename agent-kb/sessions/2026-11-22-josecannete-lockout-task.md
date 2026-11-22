# 2026-11-22 — lockout-task

- **Who:** josecannete (+ agent)
- **Branch / PRs:** `josecannete/lockout-task`
- **Goal:** put the lockout demo task and its generated clips in the repo so the web player and the task
  library can use them.

## Done
- `tasks/industrial_safety/` (ontology v1 + `conveyor_lockout`): stop the belt, open the isolation switch,
  padlock and tag, test the start, then clear the jam; mistake `hand_in_unlocked` (reaching in before locking
  out and testing). Completion cues describe still, visible results, as D-020's checks need.
- `sim/video/conveyor_lockout/`: the two Veo clips (correct, mistake), 9 labelled frame pairs, the prompts.
- Learned-controller weights for the task; `training/results/controller.md` regenerated (only additions).

## Decisions
- None (D-020 is in the completion-checks PR).

## Open / blocked
- The clip player (web) and which clip plays for each branch: Anaís.
- Only two clips: the start test and a clean "clear the jam" aren't generated (credits).

## Next
- Demo run with the player, voice and `SUP_VLM_CHECK_TASKS=conveyor_lockout`.
