#!/usr/bin/env bash
# Primary probe CLI entry point. Forwards all arguments to the Node probe runner.
#
# Direct usage (preferred when passing flags):
#   ./scripts/probe.sh ceo-15m-suite --dry-run --target=staging
#
# Make usage (flags via PROBE_FLAGS variable, immune to GNU Make parsing):
#   make probe SUITE=ceo-15m-suite PROBE_FLAGS='--dry-run --target=staging'
#   make probe-all PROBE_FLAGS='--target=staging'
set -euo pipefail
exec npx tsx scripts/probe.ts "$@"
