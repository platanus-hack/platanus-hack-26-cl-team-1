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
- **Desktop and accessibility fixes from a code audit (3 auditors + skeptical verifiers):**
  - laptop-height windows (≤ 900 px tall): the panel scrolls as one column; before, the fixed results block left
    the controls a 170–240 px strip at 1280×720;
  - map notes and tool hints sit between the layers card and the zoom buttons (they covered the card at
    1024–1440 px); the floating time bar moved up 10 px, clear of the scale bar and attribution;
  - "Al final (24:00 del 2 feb 2024)" instead of "Al final (00:00)" (`minToEndLabel`, tested);
  - real-weather sliders say what they adjust: "Viento (factor)", "Dirección del viento (giro)",
    "Humedad relativa (ajuste, pts)", "Temperatura (ajuste, °C)";
  - nested disclosures (cuerpos, refuerzos, supuestos) show ▸/▾; the scenario note gets the panel's inset;
    the top-bar subtitle shows in full on hover;
  - sliders: `aria-valuetext` with the shown value and `<label htmlFor>`; segmented pickers are toggle
    buttons (`aria-pressed`, no radio roles without arrow keys); tool buttons drop `aria-pressed` (their label
    already changes); the sources dialog is named; MapLibre's controls in Spanish (`locale`).
- **Touch fixes from the touch audit (all 9 confirmed by a verifier, then checked at 360×740 with touch emulation):**
  - Bomberos: the truck tables fit a 360 px phone (station names wrap; each table scrolls on its own if needed;
    before, the whole sheet panned sideways); steppers at 16 px with the number keypad (the earlier coarse rule
    lost to the later base rule); source chips ("fuente", "supuesto") open their citation on tap, and the
    historical road cut gets one (its source was only a `title`);
  - map taps on a house or a street use a 2.5× hit box on touch (houses are 1–2 px at the fitted zoom);
  - hover styles only where there is hover (a tapped 3D button kept the grey hover look instead of "on");
  - 36 px MapLibre buttons and household-popup close button, 40 px disclosure rows;
  - Fuentes y supuestos on a phone: "Cerrar" stays pinned while the dialog scrolls, 720 px cap and safe areas;
  - safe areas in the wide layout (landscape iPhone Pro Max is 926–956 px wide) and for the narrow overlays;
  - startup splash on a short landscape screen no longer overlaps itself.
- Checked in the browser pane at 375×812, 812×375, 768×1024 and 1440×900 (desktop DOM and layout as before).

## Decisions
- None new. The phone layout keeps the same width split (900 px) the app already used.

## Open / blocked
- Audit items left for the team: household colours rely on red/green alone (a colour-blind-safe "Sale a tiempo"
  colour changes the map's visual language); results are not announced to screen readers (no live region);
  the Calles checkbox looks clickable while routes or a street tool force it on; mixed decimal separators
  (`toFixed` vs es-CL) in the Clima section.
- Not tried on a real iPhone/Android: drag physics and safe areas were checked with emulation and synthetic
  pointer events only.

## Next
- A side panel instead of the sheet for landscape tablets between 600 and 899 px tall enough to fit it.
