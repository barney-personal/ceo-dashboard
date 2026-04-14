.PHONY: dev build start lint type-check test setup deps ensure-doppler db-generate db-migrate db-studio probe probe-all

setup:
	./scripts/setup.sh

deps:
	./scripts/ensure-node-modules.sh

dev: ensure-doppler
	doppler run -- npm run dev

build:
	npm run build

start:
	npm start

lint:
	npm run lint

type-check:
	npx tsc --noEmit

test:
	./scripts/ensure-node-modules.sh
	npx vitest run

ensure-doppler:
	@doppler run -- true 2>/dev/null || doppler setup --project ceo-dashboard --config dev --no-interactive

probe:
	@if [ -z "$(SUITE)" ]; then echo "Error: SUITE required. Usage: make probe SUITE=<name> [PROBE_FLAGS='--dry-run --target=staging']" >&2; exit 1; fi
	@./scripts/probe.sh $(SUITE) $(PROBE_FLAGS)

probe-all:
	@./scripts/probe.sh --all $(PROBE_FLAGS)

db-generate: ensure-doppler
	doppler run -- npx drizzle-kit generate

db-migrate: ensure-doppler
	doppler run -- npx drizzle-kit migrate

db-studio: ensure-doppler
	doppler run -- npx drizzle-kit studio
