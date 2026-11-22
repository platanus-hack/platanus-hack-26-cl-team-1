# 2026-11-22 — ui-fixes-pr

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** `codex/ui-layout-copy-cleanup` → `main`.
- **Goal:** commit and publish the population-card and frontend-scope fixes, without coauthor trailers.

## Done
- Used a clean temporary worktree from current `origin/main` (`86925e7`); preserved the older shared
  checkout and all its unrelated changes.
- Ported the population-note minimum three-line height and tabular numerals without regressing newer
  scenarios or the mobile sheet.
- Found that current main has optional firefighting controls absent from the earlier checkout. Unmounted
  that section, removed its map toggle and hid its overlays. Removed its visible copy from Results,
  historical validation, Talca notes, planning and firebreak explanations. Engines/data remain intact.
- Replaced the earlier raw-source guard with rendered-copy regression tests across every timeline,
  including both legacy enable states, the source modal, layers and ember explanation.
- Local validation: all 230 web tests, typecheck, build and whitespace checks passed. The production bundle
  has none of the removed UI phrases; the existing chunk-size warning remains.
- Included the two prior append-only session logs and clarified D-026's frontend presentation scope.
- Commit/PR attribution follows the user's instruction: no coauthor or AI-attribution trailers.

## Decisions
- D-026 presentation clarification: hide the optional UI without deleting the model, contracts or data.

## Open / blocked
- GitHub CI and final PR publication status are recorded below after publication.

## Next
- Publish the branch as a PR to `main`; leave merging to the user once Lint and Test are green (D-020).

## Publication
- Created commit `1bce67c` with no coauthor trailers and pushed the scoped branch.
- Opened https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/72 against `main`; CI runs Lint
  and Test. The PR stays unmerged; readiness is marked after validation/publication bookkeeping.
