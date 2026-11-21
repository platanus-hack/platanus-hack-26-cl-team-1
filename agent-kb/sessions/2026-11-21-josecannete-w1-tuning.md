# 2026-11-21 — w1-tuning

- **Who:** josecannete (+ agent, workspace W1)
- **Branch / PRs:** https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/34 (tools), `josecannete/perception-fixes` (fixes)
- **Goal:** see why the first live webcam run (hand washing, iPhone) went badly, and fix it.

## Done
- **Tools:**
  - `SUP_VLM_RECORD_DIR` records every VLM call (frames, next steps, raw answer).
  - `app.perception.review`: a labelling page that replays the controller on the model's answers and on
    the labels, and reports accuracy, confusions and missed actions.
  - `app.perception.rejudge`: the same frames through the current prompt and model, scored against the
    labels.
- **Labelled the 138-call run from the frames.** With perfect perception the controller was fine, so the
  problem was perception: 60% of calls right, `apply_soap` and the bare-hand faucet missed, `rub_backs`
  read as `rub_palms` 23 times.
- **Fixes** (each measured, see `training/results/perception.md`):
  - generic describe-then-decide prompt, with `note` first
  - sharper hand-hygiene cues
  - a guard: a forbidden action only counts when its step is due
  - inference of one unseen prerequisite after 4 sightings
  - frames per call configurable (default 3 over 1.1 s); a call every 0.75 s
- **Bigger models on the 5090:** 30B-A3B Instruct and Thinking AWQ. Both worse (52–56%); the Thinking
  model is slow (p95 12.8 s). The 8B stays.
- **Fine-tune pipeline:** `app.perception.dataset` (labelled runs → production-format examples, split by
  session) and `training/vlm/train.py` (ported Unsloth QLoRA). Not trained yet: one session isn't enough.
- **Box:** `gpu/vllm-5090.sh` takes `VLM_MAX_IMAGES` (default 4) and `VLM_EXTRA_ARGS`. The 8B is back on
  :8001; the 2B on :8002 is stopped.
- **Session tests:** `tests/test_server.py` injected `touch_faucet_bare` right after wetting. That's no
  longer a mistake, so they now inject `rinse_hands` (out of order).
- **Camera picker:** dropped from #34, because main got the new supervisor page with its own picker.

## Decisions
- → D-017.

## Open / blocked
- Palms vs backs is still ~20 wrong calls on the run; a fine-tune is the likely fix.
- 3 frames and the 0.75 s interval can't be judged offline (the recording kept ~2 frames per call): the
  next labelled live run will tell.
- Frames before session ids existed were overwritten across sessions (fixed); only s13 of run 1814 is
  usable.

## Next
- A labelled live run of the demo task with the new defaults; 3+ more runs, then the first QLoRA.
