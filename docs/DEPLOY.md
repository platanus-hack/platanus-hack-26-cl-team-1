# CI/CD and deployment on Render

## Pipelines

| Workflow | Runs on | What it does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | pull requests, pushes to any branch except `main` | Backend `pytest` (with a real `arduino-cli` + Uno core), frontend typecheck / vitest / Vite build, builds the three Docker images and smoke-tests `api` and `web`. |
| [`cd.yml`](../.github/workflows/cd.yml) | every push to `main` (or by hand: *Actions → CD → Run workflow*) | Runs the same CI, then triggers Render's deploy hooks with `ref=<commit>` for api, worker and web, and waits until `GET /api/health` on the public URL reports that commit. |

A failing CI never deploys. Deploys are queued (never cancelled halfway). To push to `main`
without deploying, put `[skip ci]` in the commit message.

## Render topology ([`render.yaml`](../render.yaml))

| Service | Type | Image | Notes |
|---|---|---|---|
| `circuito-vivo-web` | web (public) | `docker/Dockerfile.web` | nginx: SPA + `/api` proxy to the API over the private network. Health check: `/healthz`. |
| `circuito-vivo-api` | private service | `docker/Dockerfile.api` | FastAPI. Holds the Anthropic key. |
| `circuito-vivo-worker` | background worker | `docker/Dockerfile.worker` | Celery + arduino-cli (Uno + ESP32 cores baked in). **No secrets.** |
| `circuito-vivo-redis` | Key Value | — | Celery broker/results + compiled binaries (1 h TTL). Private network only. |

Render services do not share disks, so the worker also stores each compiled binary in Redis and
the API serves it from there (`backend/app/compile/artifacts.py`); docker compose keeps using the
shared volume.

## One-time setup

1. **Create the Blueprint**: Render dashboard → *New → Blueprint* → pick this repo (branch `main`).
   When asked, fill `ANTHROPIC_API_KEY` (and `ANTHROPIC_BASE_URL` only if you use the LLM proxy)
   for `circuito-vivo-api`. Plans default to Render's smallest paid instances (private services
   and workers have no free plan); the worker runs one compile at a time to fit an ESP32 build in
   512 MB, so raise `--concurrency` in `render.yaml` only together with a bigger plan.
2. **Deploy hooks → GitHub secrets**: for each of the three services, *Settings → Deploy Hook →
   copy*, and add it in GitHub (*Settings → Secrets and variables → Actions → Secrets*):
   - `RENDER_DEPLOY_HOOK_API`
   - `RENDER_DEPLOY_HOOK_WORKER`
   - `RENDER_DEPLOY_HOOK_WEB`
3. **Public URL → GitHub variable**: add `RENDER_WEB_URL` (e.g. `https://circuito-vivo-web.onrender.com`)
   under *Variables*. Without it CD still deploys but cannot confirm the release went live.

Until the secrets exist, CD finishes green with a "Deploy skipped" warning.

Auto-deploy is `off` for every service in the Blueprint on purpose: GitHub Actions decides when
to deploy, after CI passes. (Calling a hook with `ref` also turns Render's auto-deploy off.)

## Running the same images locally

```bash
docker compose up --build   # http://localhost:8080
```

The web image takes `PORT` (default 80) and `API_HOSTPORT` (default `api:8000`), which is how
the same image runs in compose and on Render.
