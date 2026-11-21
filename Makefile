.PHONY: dev install test typecheck build

install:
	cd frontend && pnpm install
	cd backend && uv sync

dev:
	./scripts/dev.sh

typecheck:
	cd frontend && npx tsc -b --noEmit

test:
	cd frontend && npx vitest run
	cd backend && uv run pytest -q

build:
	cd frontend && pnpm build
