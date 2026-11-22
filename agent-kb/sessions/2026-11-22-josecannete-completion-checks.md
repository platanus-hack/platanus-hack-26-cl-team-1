# 2026-11-22 — completion-checks

- **Who:** josecannete (+ agent)
- **Branch / PRs:** `josecannete/flight-simulation-brainstorming` (completion checks)
- **Goal:** test a video model as the simulator for a new demo (lockout before maintenance), and stop the
  supervisor from ticking a step on a motion that doesn't finish.

## Done
- Video model as simulator, feasibility: ElevenLabs' Image & Video API needs a Pro plan (our Creator key gets
  `402 paid_plan_required`, nothing charged). Two 8 s Veo 3.1 Fast clips made in the ElevenLabs app from one
  start image (worker at a conveyor's isolation switch, padlock in hand): padlock on the handle, and the
  mistake (pockets it, reaches into the belt). They cost about half of the Creator plan's monthly credits.
- Scored with the real 8B on 9 labelled frame pairs × 3 (`app.perception.cases`) and replayed whole through a
  live session over the WebSocket. The deadly mistake ("¡Alto! No metas las manos…") fires every time,
  ~5 s into the clip. The padlock step was ticked while the worker only held or pocketed the padlock.
- D-020: completion checks for opted-in tasks (`SUP_VLM_CHECK_TASKS`). With them: the padlock is ticked only
  once it hangs (~5 s into the correct clip, 2/2 replays) and never in the mistake clip (2/2); the mistake is
  still caught 6/6 on frames and 2/2 in replays. Tests for the combine rules, the per-step questions, the
  bigger checked frame, garbled answers and the setting.

## Decisions
- D-020 (D-019 is taken by #46).

## Open / blocked
- The lockout task, the clips and the frames are local (`.context/`); they go to the repo in their own PR.
- Video generation through the API needs a Pro plan; the app works on Creator but credits are tight.

## Next
- Lockout task + clips in the repo; a branch-picking clip player (web); run the demo with voice.
