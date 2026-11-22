# 2026-11-22 — render-cloudflare

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** `codex/render-cloudflare`
- **Goal:** publish Cortafuego on Render and connect cortafuego.app through Cloudflare, using Firefox.

## Done
- Created Render Static Site `cortafuego` from the public organization repository, `main`, root `web`, publish
  `dist`. Pinned pnpm 10.34.9 in the build command and Node 24; explicit install uses the frozen lockfile.
- First production build/deploy of `842d870` succeeded in 16.2 seconds; origin https://cortafuego.onrender.com.
- Added Cloudflare apex and `www` CNAMEs to the Render hostname. Waited for both origin certificates to issue,
  then enabled proxying. Render handles the `www` → apex redirect.
- Applied strict TLS, HTTPS redirects, minimum TLS 1.2, origin-respecting browser caching and Early Hints;
  verified HTTP/2, HTTP/2-to-origin, HTTP/3 and TLS 1.3 already enabled. Kept Rocket Loader disabled.
- Added Render caching/security headers (D-022): immutable hashed assets; revalidate HTML and unversioned data.
- Verified https://cortafuego.app in Firefox: valid HTTPS, rendered terrain/map layers, loaded baked data and
  completed fire + evacuation worker calculations. Navigating to https://www.cortafuego.app returned to apex.
- Set `deploy-url` in `platanus-hack-project.jsonc` to https://cortafuego.app and recorded deployment settings.
- Local Vitest: 8 files / 74 tests passed. Render's clean production TypeScript + Vite build passed.
- Read-only production GET checks: HTML, grid JSON and hashed JS return HTTP 200; `www` and plain HTTP return
  301 to the HTTPS apex. Brotli compression is active, hashed JS is a Cloudflare cache HIT with one-year
  immutable caching, and HTML/data use `no-cache`. Security headers and HTTP/3 advertisement are present.
- Committed deployment notes and metadata as `457c2e4` and pushed `codex/render-cloudflare` for PR review.

## Decisions
- → D-022: Render Static Site plus Cloudflare; no backend, paid instance, GitHub integration grant or mirror.

## Open / blocked
- Public Git source's creation form says auto-deploy / PR previews require Blueprints. The generic Settings
  page displays On Commit, but webhook delivery was not verified; do not claim automatic CD works.
- Local build failed because this checkout's installed dependencies lack `@types/node`. A frozen reinstall
  could not reach the npm registry from the restricted terminal. No source/build fix was needed for Render.
- Sandboxed `gh auth status` reported invalid authentication, but an escalated Git branch push succeeded;
  network restrictions can look like authentication failures. Do not expose or write tokens into the repository.

## Next
- Merge this small metadata/docs branch through a PR after Lint and Test are green (no direct main push).
- For new releases, use Render Manual Deploy → Deploy latest commit until automatic delivery is configured.
- If baked data URLs become versioned, revisit caching to improve repeat-load performance safely.
