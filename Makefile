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
	npx tsx scripts/probe.ts $(filter-out $@,$(MAKECMDGOALS)) $(if $(target),--target=$(target)) $(if $(dry_run),--dry-run)

probe-all:
	npx tsx scripts/probe.ts --all $(if $(target),--target=$(target)) $(if $(dry_run),--dry-run)

db-generate: ensure-doppler
	doppler run -- npx drizzle-kit generate

db-migrate: ensure-doppler
	doppler run -- npx drizzle-kit migrate

db-studio: ensure-doppler
	doppler run -- npx drizzle-kit studio

# Allow `make probe <name>` to pass extra args without "No rule to make target" errors
%:
	@:
