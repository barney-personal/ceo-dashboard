.PHONY: dev build start lint type-check test setup db-push db-migrate db-studio

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

db-push:
	doppler run -- npx drizzle-kit push

db-migrate:
	doppler run -- npx drizzle-kit generate

db-studio:
	doppler run -- npx drizzle-kit studio
