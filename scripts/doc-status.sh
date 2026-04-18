#!/usr/bin/env bash
# Print live repository metrics that scorecards cite — tests, DB tables, API
# routes, dashboard pages. Use this when refreshing a scorecard to replace
# frozen counts with current numbers before bumping 'Last-reviewed'.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

echo "== ceo-dashboard live metrics =="
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "Database tables (src/lib/db/schema.ts):"
grep -cE '^export const [a-zA-Z]+ = pgTable' src/lib/db/schema.ts || true

echo
echo "API route files (src/app/api/**):"
find src/app/api -name 'route.ts' -type f 2>/dev/null | wc -l | awk '{print $1}'

echo
echo "Dashboard page files (src/app/dashboard/**):"
find src/app/dashboard -name 'page.tsx' -type f 2>/dev/null | wc -l | awk '{print $1}'

echo
echo "Test files (src/**/__tests__/**):"
find src -path '*/__tests__/*' \( -name '*.test.ts' -o -name '*.test.tsx' \) -type f 2>/dev/null | wc -l | awk '{print $1}'

echo
echo "ESLint warnings (fast check, may re-run build cache):"
if npx --no-install eslint src/ --format compact 2>/dev/null | tail -n1; then :; else
  echo "(eslint not runnable in this environment — skipped)"
fi
