#!/usr/bin/env bash
# Primary probe CLI entry point. Forwards all arguments to the Node probe runner.
# Use this instead of `make probe` when passing flags (--dry-run, --target=, --fast).
set -euo pipefail
exec npx tsx scripts/probe.ts "$@"
