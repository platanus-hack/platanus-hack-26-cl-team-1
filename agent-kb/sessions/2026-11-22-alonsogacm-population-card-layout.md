# 2026-11-22 — population-card-layout

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** existing shared `feat/scenario-today` checkout; no commit or PR requested.
- **Goal:** stop the population result explanation switching between two and three lines during playback.

## Done
- Added a dedicated `population-note` class to the population explanation, leaving other stat subtitles alone.
- Reserved three line-heights with `min-block-size: 3lh` and enabled tabular numerals, so changing the clock
  and percentage cannot collapse the note to two lines. Longer content can still grow without clipping.
- Browser verification: card height and the following controls' position were identical at 12:00 / 50 % and
  00:00 / 0 % at viewport widths 320, 375, 768 and 1440 px. Restored the test viewport afterwards.
- Validation: all 106 web tests, typecheck, production build and `git diff --check` passed.
- Preserved unrelated branding, splash, metadata and documentation edits already in the shared checkout.

## Decisions
- None; scoped presentation-only bug fix, with no model or data-contract changes.

## Open / blocked
- Production build retains its existing large-chunk warning.

## Next
- Include the local fix in the intended release PR when requested; no commit, push or deployment performed.
