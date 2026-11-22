# 2026-11-22 — mobile-ui

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** `feat/mobile-ui`
- **Goal:** a layout made for phones, without changing the desktop one, plus small desktop UX fixes.

## Done
- **Phone layout (below 900 px, `NARROW_QUERY` in `web/src/ui/useMediaQuery.ts`, same width as `styles.css`).**
  The map fills the screen under a one-row top bar (logo, the scenario as a native `<select>`, Fuentes); the
  name hides below 420 px. Everything else lives in a bottom sheet over the map (`web/src/ui/MobileSheet.tsx`):
  - closed: one results line (households whose exit is cut, hectares burned at the clock's time) and the time
    bar; tap or drag it to half or nearly full height (a 56 px strip of map stays visible); flicks move one stop;
    `sheetHeights` / `snapAfterDrag` are pure and tested;
  - the time bar is the same component, docked: two rows on phones, one row from 600 px (landscape, tablets);
  - starting a map tool closes the sheet; the map's first fit keeps the grid above the closed sheet
    (`MapView` `padBottom`); MapLibre's scale and attribution ride above the sheet (`--sheet-h`);
  - closed, the controls are `inert` (out of the tab order).
- **Touch (`pointer: coarse`, also in the wide layout on tablets):** bigger slider thumbs, switches, checkboxes,
  segmented and small buttons; 16 px selects (iOS zooms on smaller ones); "Toca" instead of "Haz clic" in the
  tool hints and the risk chart; `viewport-fit=cover` with safe-area padding.
- **Firebreak tool fix (desktop too):** the hint's "Terminar (Esc)" button left the tool, which discarded the
  line being drawn, and finishing needed a double click or Enter (impossible on a phone). The hint now counts the
  points and has **Guardar** (saves the line and leaves the tool; `MapView` `finishFirebreak`) and **Cancelar (Esc)**.
- Play button tooltip names the space-bar shortcut.
- Checked in the browser pane at 375×812, 812×375, 768×1024 and 1440×900 (desktop DOM and layout as before).

## Decisions
- None new. The phone layout keeps the same width split (900 px) the app already used.

## Open / blocked
- Not tried on a real iPhone/Android: drag physics and safe areas were checked with emulation and synthetic
  pointer events only.

## Next
- A side panel instead of the sheet for landscape tablets between 600 and 899 px tall enough to fit it.
