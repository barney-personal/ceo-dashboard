.PHONY: dev build start lint type-check test setup

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
