# 2026-11-22 — app-icons

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** existing shared `feat/scenario-today` checkout; no commit or PR requested.
- **Goal:** use the approved minimal Cortafuego logo for the app icon and favicon.

## Done
- Added `scripts/generate-icons.py`: repeatable exports from root `project-logo.svg`, with tighter framing
  for small icons and the original padded master for maskable launchers. Run with
  `uv run scripts/generate-icons.py`; requires `rsvg-convert`.
- Generated `web/public/favicon.svg`, a multi-size 16/32/48 px ICO, 180 px Apple touch icon, 192/512 px app
  icons, and a separate 512 px maskable icon.
- Added `web/public/site.webmanifest` and replaced the HTML's placeholder data-URL favicon with links to
  the real icon assets, Apple touch icon and manifest. Preserved the in-progress metadata description.
- Replaced the header's small square pseudo-element with the same SVG mark; no Topbar JSX changes.
- Added three branding regression tests covering master/source sync, PNG dimensions, manifest assets,
  HTML wiring and ICO sizes.
- Validation: web typecheck passed; 11 Vitest files / 101 tests passed; production build passed with the
  existing large-bundle warning. Python generator compiled and `git diff --check` passed.
- Visually checked the live production preview header in the browser, and raster favicons at 16/32/48 px.
  Screenshot: `tmp/app-icon-preview.jpg` (ignored local proof, not a submission asset).
- Left concurrent simulation, timeline, contract, metadata and UI work untouched outside the narrow icon
  HTML/CSS edits. No deployment was performed.

## Decisions
- Extended D-026 with single-source icon generation and app integration; no offline cache or service worker.

## Open / blocked
- None.

## Next
- Commit these icon assets, wiring, tests and KB changes with the intended release PR, then deploy.
