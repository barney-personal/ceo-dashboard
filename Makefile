.PHONY: dev build start lint type-check test setup deps db-generate db-migrate db-studio

setup:
	./scripts/setup.sh

deps:
	./scripts/ensure-node-modules.sh

dev:
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

db-generate:
	doppler run -- npx drizzle-kit generate

db-migrate:
	doppler run -- npx drizzle-kit migrate

db-studio:
	doppler run -- npx drizzle-kit studio
