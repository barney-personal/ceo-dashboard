.PHONY: test setup

setup:
	./scripts/setup.sh

test:
	@echo "No test command configured. Edit Makefile to add your test runner."
	@echo "Examples:"
	@echo "  python -m pytest tests/ -v"
	@echo "  npm test"
	@echo "  go test ./..."
	@exit 1
