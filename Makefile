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
	@./scripts/probe.sh $(filter-out $@,$(MAKECMDGOALS))

probe-all:
	@./scripts/probe.sh --all

db-generate: ensure-doppler
	doppler run -- npx drizzle-kit generate

db-migrate: ensure-doppler
	doppler run -- npx drizzle-kit migrate

db-studio: ensure-doppler
	doppler run -- npx drizzle-kit studio

# Allow `make probe <name>` to pass extra args without "No rule to make target" errors
%:
	@:
