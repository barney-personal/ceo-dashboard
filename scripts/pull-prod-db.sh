#!/usr/bin/env bash
# Pull a fresh copy of production Postgres into the local dev database.
#
# Requires:
#   - pg_dump + pg_restore on PATH (install with `brew install postgresql@16`)
#   - PROD_DATABASE_URL in Doppler `dev` (run once; see error message below)
#   - DATABASE_URL (local) in Doppler `dev` — already there by default
#
# Usage:
#   doppler run -- ./scripts/pull-prod-db.sh        # interactive confirm
#   doppler run -- ./scripts/pull-prod-db.sh --yes  # skip confirmation

set -euo pipefail

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -h|--help)
      awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  red "pg_dump / pg_restore not found on PATH."
  echo "Install with: brew install postgresql@16"
  echo "Then add to shell: echo 'export PATH=\"/opt/homebrew/opt/postgresql@16/bin:\$PATH\"' >> ~/.zshrc"
  exit 1
fi

if [ -z "${PROD_DATABASE_URL:-}" ]; then
  red "PROD_DATABASE_URL not set."
  echo
  echo "One-time setup: grab the External Database URL from Render"
  echo "  → ceo-dashboard Postgres → Connect → External → copy the URL"
  echo "then save it to Doppler dev:"
  echo
  echo "  doppler secrets set PROD_DATABASE_URL=\"postgres://...?sslmode=require\" \\"
  echo "    --project ceo-dashboard --config dev"
  echo
  echo "After that, always invoke via \`doppler run -- ...\` (or \`make db-pull-prod\`)."
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  red "DATABASE_URL (local) not set. Run via \`doppler run -- ...\`."
  exit 1
fi

# Hard rail: never let this script clobber a non-localhost DB.
if ! printf '%s' "$DATABASE_URL" | grep -qE '@(localhost|127\.0\.0\.1)(:|/)'; then
  red "DATABASE_URL does not point at localhost — refusing to run."
  echo "DATABASE_URL=$DATABASE_URL"
  exit 1
fi

# Extract local db name for dropdb/createdb.
LOCAL_DB=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')
if [ -z "$LOCAL_DB" ]; then
  red "Could not parse local DB name from DATABASE_URL."
  exit 1
fi

DUMP_FILE=$(mktemp -t ceo-dashboard-prod.XXXXXX.dump)
trap 'rm -f "$DUMP_FILE"' EXIT

yellow "About to replace local database \"$LOCAL_DB\" with a fresh dump of production."
dim    "  source: $(printf '%s' "$PROD_DATABASE_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"
dim    "  target: $DATABASE_URL"
dim    "  dump:   $DUMP_FILE (deleted on exit)"
echo

if [ "$YES" != 1 ]; then
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "aborted."; exit 1 ;;
  esac
fi

echo
green "[1/3] pg_dump from production…"
pg_dump -Fc --no-owner --no-acl --verbose "$PROD_DATABASE_URL" -f "$DUMP_FILE" 2>&1 \
  | grep -E '^pg_dump: (dumping|saving|error)' || true

echo
green "[2/3] recreating local database \"$LOCAL_DB\"…"
# Connect to `postgres` maintenance DB to drop/create the target.
LOCAL_ADMIN_URL=$(printf '%s' "$DATABASE_URL" | sed -E "s|/${LOCAL_DB}(\?.*)?$|/postgres\1|")
psql "$LOCAL_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$LOCAL_DB\" WITH (FORCE);" >/dev/null
psql "$LOCAL_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$LOCAL_DB\";" >/dev/null

echo
green "[3/3] pg_restore into \"$LOCAL_DB\"…"
pg_restore --no-owner --no-acl --exit-on-error -d "$DATABASE_URL" "$DUMP_FILE" 2>&1 \
  | grep -vE '^$' || true

echo
green "✅ done — \"$LOCAL_DB\" now mirrors production."
dim "Next run \`make dev\` (or refresh if the server is already up)."
