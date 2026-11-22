# 2026-11-21 — w1-throughput

- **Who:** josecannete (+ agent, workspace W1)
- **Branch / PRs:** https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/45
- **Goal:** more perception calls per second, so brief actions get caught.

## Done
- **Profiled one call on the 5090 (8B FP8):**
  - ~0.78 s, dominated by output tokens (~93).
  - 2 vs 3 frames, and 448 vs 640 px, change latency < 5%.
  - A 120-char note saves ~12% (not applied: it would change the prompt we just measured).
  - vLLM batching: 4 concurrent calls give 4.5 calls/s at the same latency.
- **Pipelined calls in `VlmPerception`** (`SUP_VLM_MAX_IN_FLIGHT=3`, every 250 ms), delivered in launch order.
  Nothing changed in the session or the contracts.
- **Rules inference** also needs a ≥ 2 s span of sightings, so faster perception doesn't infer sooner.
  The replays of the labelled run are unchanged.
- **`app.perception.bench --stream`:** 1.11 → 2.84 observations/s (p50 777 → 843 ms).

## Decisions
- → D-018.

## Next
- A labelled live run with the new defaults: do we catch soap / backs more often?
