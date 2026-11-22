# 2026-11-22 — demo-hardening

- **Who:** chichitaocss (+ Claude, a 99-agent review workflow)
- **Branch / PRs:** `fix/live-ignition-guards`
- **Goal:** make sure a live demo on Talca (fire starts placed anywhere, every slider, firebreaks drawn and removed)
  cannot be stopped by an error.

## Done
- Adversarial review: five lenses (fire starts, firebreaks, every control, the ember range of PR #64, switching and
  offline) plus three gap lenses (drawing, playback, base comparison); 71 findings reproduced by a second agent, 2
  refuted. Also driven by hand in the browser.
- Fixed the demo-breakers (D-035): clicks outside the area refused with a note; fire starts on water, bare ground or
  a firebreak moved to the nearest vegetation with a note (`snapIgnitions`, tests); the worker keeps the last good
  fire input after a failed run; data load retries in the worker and a "Reintentar" screen with the picker;
  "Fijar como escenario base" disabled while busy or on error. (The hint's button that discarded a firebreak was
  fixed on main meanwhile by the UI audit; this branch takes main's version.)
- Checked in the browser on Talca: outside click (note, no error), river click (moved 85 m, note), line over the
  preset start (no error), base button (disabled right after a change), failed load of
  Eaton and Viña (error, "Reintentar", loads once the file is back).

## Decisions
- D-035: live placement never stops the simulation.

## Open / blocked
- Not fixed (confusing, not breaking): firebreaks exist from 12:00 (no build time); house colours show the final
  result at every clock time; a fire start added at the end of the window barely burns; a drawn line can make some
  cells burn earlier (the model is not monotone); "≈ personas" multiplies buildings by persons per household.
- For the demo: open `?escenario=talca` directly (the default landing, "Desde hoy", needs the forecast API), set the
  clock before adding fire starts, and prefer a local `make dev` if the venue network is poor.

## Next
- Merge this and PR #64; re-run the review on the merged result.
