# 2026-11-21 — recording-clock

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/recording-clock` (see the PR list)
- **Goal:** fix the blocking Haiku finding on #36 (merged unfixed) and its two non-blocking labeler findings.

## Done
- Expert recordings stamp each ground-truth event with the recorder's clock (`CanvasRecorder.elapsedS`), not
  simulator time, so `ClipRecord.path#t=a,b` matches the video even when the tab pauses. Reproduced: with the
  page blocked 3 s mid-recording, sim time read 1.85 s and the video 4.60 s at the next key; the label is 4.6 s.
- `labelRun` classifies every event before deciding whether its segment is long enough, so two actions in the
  same instant still advance the recipe; the too-short one is listed in `dropped` (it used to vanish and break
  the labels after it).
- `labelRun` takes the run's split explicitly; the page passes `train` (expert runs are fine-tuning data).

## Decisions
- None.

## Open / blocked
- None for this fix. Recording upload is still the download mock.

## Next
- —
