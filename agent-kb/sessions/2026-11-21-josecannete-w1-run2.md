# 2026-11-21 — w1-run2

- **Who:** josecannete (+ agent, workspace W1)
- **Branch / PRs:** `josecannete/water-cues-confirm` (PR link in backlog)
- **Goal:** second live run (iPhone in Safari, pipelined calls): find out why it was still unreliable, and fix it.

## Done
- **Camera:** Safari lists and opens the iPhone (checked with a diagnostic page in the user's Safari). Short
  sessions died while the phone was carried: the supervisor page stops after 3 s with no frames. With the phone
  on a stand, one session ran 111 s at ~3 answers/s.
- **Labelled that session** (320 calls) from the frames. The user lathers under running water, and the old cues
  said rubbing happens away from it. Single stray answers completed steps early and caused 7 warnings.
- **Fixes:** water-aware cues; the rules controller acts only when 2 of the last 3 answers agree (VLM only);
  `review` and `rejudge` replay with the live setting. Measured in `training/results/perception.md` (run 2).

## Decisions
- → D-019.

## Open
- Brief actions (bare-hand faucet, towel close) seen by one answer are now ignored. A third run with the new
  settings will show whether ~3 answers/s gives them 2.
- The supervisor page (Anaís): a 3 s freeze ends the session. Consider pausing instead, for a camera that moves.
