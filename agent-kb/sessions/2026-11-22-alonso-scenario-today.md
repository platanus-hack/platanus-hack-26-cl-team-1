# 2026-11-22 — scenario-today

- **Who:** alonso (+ agent)
- **Branch / PRs:** `feat/scenario-today`
- **Goal:** a new scenario whose timeline starts today, opened by default, with the 2 Feb 2024 fire as a choice.
  Follow-up from the user: the today window is 24 hours (00:00 to 24:00); known events keep their validated,
  real duration.

## Done
- `TIMELINE` closed set in `types.ts` (`hoy`, `vina-2024`); `Dataset` gains `timeline` and
  `windDirCorrectionDeg` (ERA5 −10° for the baked files, 0 for a forecast).
- `src/data/forecast.ts`: today's date in America/Santiago, the Open-Meteo Forecast API URL (same point and
  variables as `pipeline/steps/weather.py`, today and tomorrow), and a parser that checks units, missing hours
  and coverage, then reuses `parseWeather`. Errors are `DataError`s shown in the UI.
- `src/data/timeline.ts`: `timelineDataset(base, choice)`; the today view moves t0 to today 12:00 (offset from
  the API), swaps in the forecast, retimes the 2024 ignition points and the brigades.json dispatch,
  reinforcement and Ruta 68 cut times to the same minutes after t0, drops FIRMS.
- Rebased onto `main` after #54 (Bomberos) merged: the brigade script passes the ERA5 correction, and the today
  timeline would otherwise have dispatched the companies ~2.8 years before t0.
- UI: top-bar picker (short labels on phones) and `?escenario=`; a loading screen and an error screen with
  "Reintentar" / "Ver el incendio del 2 feb 2024"; the explorer remounts per timeline; the worker gets the
  choice in `init`. Panel: forecast labels, the wind hint says "sin corrección", a note on what the today
  scenario assumes, the day of week from the presence model (`dayKind`), Validación only for 2024; the FIRMS
  layer toggle is hidden when there are no detections; the scar layer is now "Cicatriz 2024".
- Checked in the browser: today (22 nov 2026, Sunday, wind 12-20 km/h, RH ~50 %) burns 2,044 ha by midnight
  with 108 households cut off (91 with Bomberos on, companies leaving 15:10, Ruta 68 cut 17:00); the 2024 view
  still gives 18,108 ha, 28,119 buildings and 4,753 households (unchanged). `?escenario=2024` shows a notice
  and rewrites the URL. Forecast failure (fetch blocked in the page) shows the error screen; reload recovers. Phone
  width (375 px): no horizontal overflow. No console errors.
- Tests: forecast parsing and dates (Santiago vs UTC, month/year ends, offsets), the today dataset, the URL
  values, `dayKind`, and the weather builder without correction. `pnpm typecheck`, `pnpm test`, `pnpm build`
  green.

- Review workflow (3 lenses, each finding verified by a skeptic agent): 5 of 10 findings confirmed and fixed
  (brigade times after the rebase, a late forecast restarting the 2024 worker without a run, unknown
  `?escenario` values, day-of-week copy stated holidays as working days); also added a 30 s forecast timeout,
  a refetch when "Desde hoy" is reopened on a later date, and clearer fuel wording.

- 24-hour window: `Dataset.horizonMin` and `defaultAlertMin` per timeline replace the global `HORIZON_MIN`
  (charts, time bar, sliders, playback, worker, Bomberos). Today: t0 00:00, 24 h, ignitions / brigade times /
  alert (18:00) at the same time of day as in 2024; charts label every 6 h on windows over 12 h. 2024 still
  12:00 to midnight with the same numbers. Results for today are unchanged (the fire still starts at 12:05);
  the window now lets an ignition be placed at any hour of the day.
- Rebased again after #53 (pace recalibration, which took D-027; this one is D-028). Checked in the browser on
  that base: the 2024 replay gives 18,008 ha, 29,209 buildings and 4,061 households cut off at 18:00, as #53
  reports; today (forecast fetched ~03:00) gives 1,115 ha, 133 buildings and 68 households, 00:00 to 24:00.
  140 tests, typecheck and build green.
- The top-bar subtitle no longer ends in "· Viña del Mar, Quilpué y Villa Alemana" (the app is meant to cover all
  of Chile and other countries); the page description names Viña del Mar only for the 2024 fire. The picker still
  reads "2 feb 2024 · Viña del Mar".
- At the user's request, brought in the minimal-logo, app-icon and splash-animation work that another session
  left uncommitted in the shared checkout (its session logs are included unchanged). Merged the splash into
  this App.tsx (unknown-link notice and per-day explorer key kept); its decision is D-029 (its logs say D-026)
  and D-025 moved to §3. Not brought in: that checkout's edit to the jsonc description (not part of the
  request). Checked in the browser: splash, header mark, favicon/ICO/touch icon/manifest served, no console
  errors, no overflow at 375 px. 15 test files / 148 tests, typecheck and build green.

## Decisions
- → D-028 (D-026 is Bomberos, #54; D-027 the pace recalibration, #53).

## Open / blocked
- Today's run uses pre-2024 fuels (no regrowth in the 2024 scar) and drought factor 10 by default; the panel
  says so. A seasonal default for the drought factor / curing would need a source.
- #53 (pace back-test, draft) also touches `types.ts`, `Panel.tsx` and the fire engine: whichever merges second
  needs a rebase.
- The main checkout was shared with another session (logo and app icons); this work was finished in a separate
  worktree and pushed from there. The local `feat/scenario-today` in the main checkout is stale (first commit
  only) and carries that session's uncommitted files.

## Next
- Pitch: open `https://cortafuego.app/?escenario=vina-2024` for the validated replay.
