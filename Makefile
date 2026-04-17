.PHONY: dev build start lint type-check test setup deps ensure-doppler db-generate db-migrate db-studio probe probe-all sync-render-env

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

# Push Doppler `prd` secrets to Render (web + sync-worker). Requires a Render
# API key — pass via env or grab from Doppler if you've stored it there:
#   make sync-render-env RENDER_API_KEY=rnd_...
#   doppler run -- make sync-render-env  # if RENDER_API_KEY is in Doppler
sync-render-env:
	@if [ -z "$$RENDER_API_KEY" ]; then \
	  echo "error: RENDER_API_KEY required (env var or 'doppler run -- make sync-render-env')" >&2; \
	  exit 2; \
	fi
	python3 scripts/sync-doppler-to-render.py
