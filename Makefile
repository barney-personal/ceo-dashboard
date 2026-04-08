.PHONY: dev build start lint type-check test setup db-generate db-migrate db-studio

setup:
	./scripts/setup.sh

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
	npx vitest run

db-generate:
	doppler run -- npx drizzle-kit generate

db-migrate:
	doppler run -- npx drizzle-kit migrate

db-studio:
	doppler run -- npx drizzle-kit studio
