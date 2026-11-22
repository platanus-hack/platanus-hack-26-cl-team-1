# 2026-11-22 — splash-animation

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** existing shared checkout; no commit or PR requested.
- **Goal:** animate the approved logo on the splash screen, showing the flame cut by its firebreak.

## Done
- Added `StartupSplash.tsx` and its scoped CSS: a restrained flame entrance, an 820 ms SVG mask stroke
  after a 380 ms delay, a brief leading glint, and a 240 ms exit fade once the app is ready.
- Integrated the splash around the existing app loading, error and explorer branches. Requests and worker
  preparation proceed behind the overlay; the underlying app is inert and hidden from assistive technology
  until dismissal. Scenario switches do not replay the initial intro.
- Kept actual loading messages, immediate startup-error visibility, a skip-animation button and a static,
  immediate-when-ready reduced-motion path. The flame animation plays only once.
- Extended the existing icon generator to emit `logoGeometry.generated.json` from the canonical SVG; no
  separately redrawn flame or cut path. Branding regression checks cover these generated values.
- Added five component rendering tests for exact geometry, truthful status, mounted/inert app content,
  fast readiness, errors and unique mask IDs.
- Browser QA against the production build: captured the entrance, visible progressive cut and fade;
  verified automatic entry, skip behavior, restored interactivity and no console errors.
- Validation: TypeScript passed; 12 Vitest files / 106 tests passed; production build passed with the
  existing bundle-size warning; `git diff --check` passed.
- Local proof: `tmp/splash-animation.gif` (actual browser capture, ignored) and
  `tmp/splash-sequence.jpg` (contact sheet). No deployment performed.

## Decisions
- Extended D-026 with the canonical-geometry animation and non-blocking initialization approach.

## Open / blocked
- None.

## Next
- Team review and commit with the icon changes in the intended release PR, then deploy.
