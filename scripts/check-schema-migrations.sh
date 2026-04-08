#!/usr/bin/env bash

set -euo pipefail

BASE_REF="${1:-origin/main}"

changed_files="$(git diff --name-only "${BASE_REF}"...HEAD)"

if ! grep -qx 'src/lib/db/schema.ts' <<<"${changed_files}"; then
  exit 0
fi

if grep -q '^drizzle/' <<<"${changed_files}"; then
  exit 0
fi

echo "Schema changed in src/lib/db/schema.ts but no checked-in migration under drizzle/ was updated."
echo "Generate and commit a Drizzle migration before merging."
exit 1
