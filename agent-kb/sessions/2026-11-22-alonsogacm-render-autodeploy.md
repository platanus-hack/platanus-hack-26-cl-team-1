# 2026-11-22 — render-autodeploy

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** `codex/render-cloudflare`, https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/51
- **Goal:** automatically deploy merged release-branch commits to Render after CI passes.

## Done
- Confirmed the default branch is `main`, not `master`; no branch rename or direct main push.
- Used an isolated worktree so the shared checkout's active population work remains untouched.
- Extended the existing deployment PR instead of creating a stacked PR; temporarily marked it draft.
- Added a Render deploy job after Lint/Test in the existing CI workflow, limited to main push events.
- Pin each request to the tested SHA, skip superseded main commits, serialize deployment triggers, and fail
  visibly on missing/wrong service hooks or HTTP errors. No checkout or broad Render API credential is needed.
- Disabled Render-native Auto-Deploy to prevent duplicate or pre-CI deployment.
- With explicit user approval, stored the existing service hook as encrypted repository secret
  `RENDER_CORTAFUEGO_DEPLOY_HOOK` in Firefox; GitHub confirmed it was added. The value never entered the repo.
- Validation: actionlint v1.7.10 passed; YAML parsed; mocked shell tests passed for current/stale commits,
  accepted HTTP 200/202, rejected HTTP failure/unexpected status, missing/wrong service hook, and no secret logs.

## Decisions
- → D-023: GitHub Actions owns deployment after successful main CI; D-020's manual PR merge policy stays.

## Open / blocked
- First merged main CI run and Render deployment must be verified before claiming end-to-end completion.

## Next
- Finish PR #51 and merge with squash after Lint/Test are green.
- Verify the resulting main CI deployment and the Render build, then recheck https://cortafuego.app.
