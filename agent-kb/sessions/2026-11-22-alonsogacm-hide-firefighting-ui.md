# 2026-11-22 — hide-firefighting-ui

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** existing shared `feat/scenario-today` checkout; no commit or PR requested.
- **Goal:** remove all frontend mentions of firefighters and firefighting simulations at the user's request.

## Done
- Removed the Results disclaimer's firefighter/rescue prefix, preserving the exposure-ceiling and
  scenario-comparison warning.
- Removed both firefighting references from historical Validation, preserving all measured values and
  the urban-exposure-overestimation warning.
- Checked the source/assumptions modal, application UI, legacy frontend assets and public data for related
  user-visible references; no other matching copy was present.
- Added `web/src/ui/uiCopy.test.ts` to guard the UI components and App against reintroducing these references.
- Clarified D-021's presentation scope and updated the backlog; engine assumptions and technical model
  documentation remain unchanged.
- Validation: all 107 web tests, typecheck, production build and `git diff --check` passed. A source and
  production-bundle scan found no remaining firefighter/firefighting UI references.
- Preserved the population-card layout fix and unrelated shared-checkout changes.

## Decisions
- D-021 clarification: frontend copy must not mention firefighters/firefighting simulations; retain the
  existing exposure/scenario-comparison caveats and underlying model assumptions.

## Open / blocked
- Production build retains its existing large-chunk warning.

## Next
- Include the local changes in the intended release PR when requested; no commit, push or deployment performed.
