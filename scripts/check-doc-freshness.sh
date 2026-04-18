#!/usr/bin/env bash
# Guard against documentation drift.
#
# Every scorecard tracked below must contain a `Last-reviewed: YYYY-MM-DD` line.
# The check fails if the most recent review is older than MAX_AGE_DAYS.
#
# Intended to run in CI and locally. Run with FIX=1 to print a patch suggestion
# instead of failing — useful when the content truly hasn't drifted and you just
# need to confirm the date.

set -euo pipefail

MAX_AGE_DAYS="${MAX_AGE_DAYS:-90}"
DOCS=(
  "SCORECARD.md"
  "RESILIENCE-SCORECARD.md"
  "ARCHITECTURE-SCORECARD.md"
)

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

today_epoch=$(date +%s)
max_age_seconds=$((MAX_AGE_DAYS * 86400))

fail=0

for doc in "${DOCS[@]}"; do
  if [ ! -f "$doc" ]; then
    echo "::warning file=$doc::missing (skipping)"
    continue
  fi

  # Grab the first Last-reviewed line; accept backticks or plain date.
  line=$(grep -m1 -E '^Last-reviewed:' "$doc" || true)
  if [ -z "$line" ]; then
    echo "::error file=$doc::missing 'Last-reviewed: YYYY-MM-DD' marker"
    fail=1
    continue
  fi

  # Extract YYYY-MM-DD regardless of surrounding backticks.
  date_str=$(echo "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n1)
  if [ -z "$date_str" ]; then
    echo "::error file=$doc::Last-reviewed marker present but date not in YYYY-MM-DD form: $line"
    fail=1
    continue
  fi

  # macOS `date -j -f` and GNU `date -d` both supported.
  if date -d "$date_str" +%s >/dev/null 2>&1; then
    doc_epoch=$(date -d "$date_str" +%s)
  else
    doc_epoch=$(date -j -f "%Y-%m-%d" "$date_str" +%s)
  fi

  age_seconds=$((today_epoch - doc_epoch))
  age_days=$((age_seconds / 86400))

  if [ "$age_seconds" -gt "$max_age_seconds" ]; then
    echo "::error file=$doc::Last-reviewed ${date_str} is ${age_days}d old (limit ${MAX_AGE_DAYS}d). Re-verify content and bump the date."
    fail=1
  else
    echo "$doc: Last-reviewed ${date_str} (${age_days}d old) — OK"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "One or more scorecards are past the ${MAX_AGE_DAYS}-day review window."
  echo "Run scripts/doc-status.sh to regenerate live metrics, then update the"
  echo "scorecard content and bump its 'Last-reviewed:' line."
  exit 1
fi
