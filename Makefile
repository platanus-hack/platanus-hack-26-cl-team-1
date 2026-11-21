# Entry points. Needs uv and Node 24 + pnpm (corepack enable, or npm i -g pnpm).
.PHONY: install dev server web test lint schemas types check

install: ## Install every part
	cd contracts && uv sync
	cd server && uv sync
	cd sim/symbolic && uv sync
	cd web && pnpm install

dev: ## Server on :8000 + web on :5173 (Ctrl+C stops both)
	@trap 'kill 0' EXIT INT TERM; \
	(cd server && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd web && pnpm dev) & \
	wait

server: ## Server only
	cd server && uv run uvicorn app.main:app --reload --port 8000

web: ## Web only (proxies /api and /ws to :8000)
	cd web && pnpm dev

schemas: ## Regenerate JSON Schemas and TS types after changing contracts/
	cd contracts && uv run python -m contracts.export
	cd web && pnpm gen:types

test: ## All tests
	python3 -I -m unittest discover -s scripts/ci/tests -t .
	cd contracts && uv run pytest -q
	cd server && uv run pytest -q
	cd sim/symbolic && uv run pytest -q
	cd web && pnpm test

lint: ## Lint and format checks
	cd contracts && uv run ruff check . && uv run ruff format --check .
	cd server && uv run ruff check . && uv run ruff format --check .
	cd sim/symbolic && uv run ruff check . && uv run ruff format --check .
	cd web && pnpm typecheck

check: lint test ## What CI runs (plus schema/type freshness)
	cd contracts && uv run python -m contracts.export --check
	cd web && pnpm check:types && pnpm build
