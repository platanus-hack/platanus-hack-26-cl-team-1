# 2026-11-22 — hoy-talca

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/demo-talca` (PR link in the PR itself)
- **Goal:** for the demo, a scenario of today in Talca that starts with no fire starts, and a way to delete fire starts.

## Done
- `TIMELINE.TODAY_TALCA` (`?escenario=hoy-talca`): Talca's territory with today's forecast at Talca's weather point,
  00:00-24:00, no ignitions. Forecast fetch takes a point; one forecast per today timeline in `App.tsx`.
- Map: with no tool on, clicking a fire start opens a popup to remove it (added) or turn it off / on (preset).
  Panel: "Quitar todas" and a hint. Talca-today note and limitation in Fuentes.
- Tests: forecast point for Talca, the Talca-today dataset (no ignitions, Talca's data only), event mapping.
  `pnpm typecheck`, eslint and `pnpm test` (213, two new) pass.
- Checked in the browser (1440 × 900; phone width: load only): Talca today loads blank (0 ha); adding a fire start at
  17:00 burns 636 ha by midnight; "Quitar foco" brings it back to 0; "Quitar todas" works; Viña today keeps its
  two 2024 points and "Desactivar foco" on one unticks it in the panel; no console errors.

## Decisions
- Today in Talca, starting blank (→ decisions.md D-036).

## Open / blocked
- The default landing is still Viña's today (D-028); making Talca-today the landing is one line in `initialTimeline`.
- The local branch `feat/bomberos-chile-dataset` (D-031) is not on `main`.

## Next
- Demo link: `https://cortafuego.app/?escenario=hoy-talca` once deployed.
