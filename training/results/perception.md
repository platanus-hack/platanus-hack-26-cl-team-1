# Perception: what helps, measured on one labelled real run

**Data:** a real hand-washing run at a sink, filmed with an iPhone (Continuity Camera): 138 VLM calls,
2026-11-21. It was labelled call by call from the frames with `app.perception.review`; a label holds until the
next one, and frames where the hands are apart showing foam count as `none`. The frames and labels are not in
the repo (personal).

**Method:** `app.perception.rejudge` sends the recorded frames through `VlmPerception` again, with the
controller replayed alongside, and scores the answers against the labels. Every row runs the same frames. The
supervisor timeline uses the final `RulesController` (D-017). With the labels as perception, the steps
complete at soap 17 s, backs 26 s, and the task at 158 s.

| Variant | Calls right | Real actions never reported (of 26) | False mistakes said | Soap / backs done at | Latency p50 / p95 |
|---|---|---|---|---|---|
| 8B FP8, live prompt (baseline) | 60% | 10 | 1 | 21 s* / 112 s | 0.49 / 0.58 s |
| 8B + generic prompt (note first, compare similar actions) | 56% | 7 | 3 | 27 s* / 56 s | 0.71 / 0.86 s |
| **8B + generic prompt + sharper action cues** | **62%** | **6** | **1** | **11 s / 26 s** | 0.75 / 1.00 s† |
| same, 3 frames per call | 62% | 6 | 1 | 11 s / 26 s | 0.75 / 1.00 s |
| 30B-A3B Instruct AWQ, 2 frames | 52% | 11 | 12 | 50 s* / 67 s | 0.52 / 0.64 s |
| 30B-A3B Instruct AWQ, 3 frames | 56% | 9 | 8 | 37 s* / 38 s | 0.52 / 0.58 s |
| 30B-A3B Thinking AWQ, 3 frames | 52% | 11 | 1 | 34 s* / 44 s | 1.84 / 12.8 s |

\* Soap is never seen. The controller infers it once rubbing has been seen 4 times in a row (D-017); without
that, the baseline would stay stuck until 79 s.
† The run with 2 frames measured 1.27 / 3.0 s while the box was also downloading the 30B weights; the
3-frame row is the clean measurement of the same prompt.

## Takeaways

- **Keep the 8B.** Both 30B-A3B models are worse on these frames, and the Thinking model is too slow to
  supervise live.
- **Most of the gain comes from describing the actions better**, i.e. what tells similar actions apart. The
  generic prompt alone lowers per-call accuracy but finds more of the real actions.
- **Still open: palms vs backs.** About 20 calls of `rub_backs` are still read as `rub_palms`. A fine-tune
  should fix it (`training/vlm`), and it needs more labelled runs.
- **3 frames can't be judged offline:** the recording kept about 2 frames per call. Live sessions now send
  3 frames over 1.1 s, with a call every 0.75 s. The next labelled live run will tell.
