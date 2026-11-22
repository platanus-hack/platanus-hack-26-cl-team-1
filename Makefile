# Entry points. Needs uv and Node 24 + pnpm (corepack enable, or npm i -g pnpm).
.PHONY: install dev data population test lint check validate build

install: ## Install every part
	cd web && pnpm install
	cd pipeline && uv sync

dev: ## Web app on :5173
	cd web && pnpm dev

data: ## Re-bake web/public/data from the open sources (downloads; slow the first time)
	cd pipeline && uv run python bake.py

population: ## Re-bake where people are by time of day: all of Chile + the simulation grid (~80 MB of downloads)
	cd pipeline && uv run python bake_population.py

test: ## All tests
	cd pipeline && uv run pytest -q
	cd web && pnpm test

lint: ## Lint and type checks
	uvx ruff@0.8.6 check pipeline
	uvx ruff@0.8.6 format --check pipeline
	cd web && pnpm typecheck

build: ## Production build of the static site (web/dist)
	cd web && pnpm build

check: lint test build ## What CI runs

validate: ## Model vs the real Sentinel-2 burn scar
	cd web && pnpm validate
