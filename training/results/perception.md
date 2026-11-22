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
| 30B-A3B Instruct AWQ, 2 frames | 52% | 11 | 12 | 50 s* / 67 s | 0.52 / 0.64 s |
| 30B-A3B Instruct AWQ, 3 frames | 56% | 9 | 8 | 37 s* / 38 s | 0.52 / 0.58 s |
| 30B-A3B Thinking AWQ, 3 frames | 52% | 11 | 1 | 34 s* / 44 s | 1.84 / 12.8 s |

\* Soap is never seen. The controller infers it once rubbing has been seen 4 times in a row (D-017); without
that, the baseline would stay stuck until 79 s.
† Latency from a re-run of the same prompt on an idle box. The first run measured 1.27 / 3.0 s while the box
was also downloading the 30B weights. That re-run asked for 3 frames, but the recording has ~2 frames per
call, so it picked the same frames and its accuracy was identical. It is **not** a 3-frame result.

## Takeaways

- **Keep the 8B.** Both 30B-A3B models are worse on these frames, and the Thinking model is too slow to
  supervise live.
- **Most of the gain comes from describing the actions better**, i.e. what tells similar actions apart. The
  generic prompt alone lowers per-call accuracy but finds more of the real actions.
- **Still open: palms vs backs.** About 20 calls of `rub_backs` are still read as `rub_palms`. A fine-tune
  should fix it (`training/vlm`), and it needs more labelled runs.
- **Small sample, tuned on itself:** 62% vs 60% is 3 calls out of 138, and the cues and the threshold of 4
  were tuned on this same run. The real test is a fresh labelled run of the demo task.
- **3 frames can't be judged offline:** the recording kept about 2 frames per call. Live sessions now send
  3 frames over 1.1 s, with a call every 0.75 s. The next labelled live run will tell.

## Run 2: pipelined calls, iPhone on a stand (D-019)

**Data:** hand washing at a sink, 2026-11-21: one session, 320 calls (~3 per second, 3 frames each), labelled
from the frames. The person lathers **under the running water**. With the labels as perception, the steps
complete at wet 4.7 s, soap 10.4 s, palms 11.9 s, backs 13.3 s, rinse 19.7 s. There is a bare-hand faucet
mistake at 28 s, and the task is done at 46 s.

| Variant | Calls right | Spoken warnings (false) | wet / soap / palms / rinse at | Bare faucet / done | p50 |
|---|---|---|---|---|---|
| live (old cues, 1 answer acts) | 76% | 7 (6) | 4.4 / 7.1 / 8.4 / 14.1 s | flagged / 43.7 s | 0.84 s |
| water-aware cues | 76% | 11 (10) | 4.0 / 9.7 / 11.9 / 21.8 s | flagged / 45.7 s | 0.71 s |
| **cues + 2 of 3 answers agree** | **77%** | **4 (4)** | **4.7 / 10.1 / 14.5 / 21.8 s** | missed / missed | 0.70 s |

The same settings on run 1 (138 calls, recorded at one call every 1.5 s): 60% of calls right (62% before).
Its single soap call can't be confirmed even with the labels, an artifact of that recording's slow cadence.

**Takeaways:** agreement removes most false warnings and early completions. The price is that very brief
actions now need about a second on camera (≈ 3 answers live). Per-call accuracy doesn't change; the cues move
*where* the errors fall.
