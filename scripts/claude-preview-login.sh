#!/usr/bin/env bash
# Log the Claude preview browser into the local dev server by generating a
# Clerk sign-in ticket for an existing user. Prints a URL the preview
# browser can navigate to — Clerk's JS consumes the ticket, creates a
# session, and redirects to the target page. This sidesteps the Google
# SSO flow that the preview browser can't complete.
#
# Usage:
#   doppler run -- ./scripts/claude-preview-login.sh [TARGET_PATH]
#     TARGET_PATH defaults to /dashboard
#
# Env:
#   CLAUDE_PREVIEW_USER_EMAIL — email of the Clerk user to impersonate
#     (defaults to the `user.email` from `git config`). Must already
#     exist in the Clerk dev instance.
#   CLAUDE_PREVIEW_PORT       — port the dev server is on (default 3101)
#
# Scope + safety:
#   - Refuses to run against a non-test Clerk key (sk_live_*). Dev
#     instance only.
#   - Impersonation only exists in the dev Clerk instance; impersonated
#     activity shows as that user in audit logs.

set -euo pipefail

if [[ -z "${CLERK_SECRET_KEY:-}" ]]; then
  echo "CLERK_SECRET_KEY not set. Run via: doppler run -- $0" >&2
  exit 1
fi
if [[ ! "$CLERK_SECRET_KEY" =~ ^sk_test_ ]]; then
  echo "Refusing to run against non-test Clerk key (must start with sk_test_)." >&2
  exit 1
fi

# Email of the Clerk user to impersonate. If the user has no env override
# and no git user.email, we list the dev instance and bail — rather than
# pick a random user and silently sign in as someone else.
EMAIL="${CLAUDE_PREVIEW_USER_EMAIL:-}"
if [[ -z "$EMAIL" ]]; then
  git_email=$(git config user.email 2>/dev/null || true)
  # Prefer a @meetcleo.com email from git config (the Clerk dev instance only
  # has meetcleo users). Otherwise require explicit CLAUDE_PREVIEW_USER_EMAIL.
  if [[ "$git_email" == *"@meetcleo.com" ]]; then
    EMAIL="$git_email"
  fi
fi
if [[ -z "$EMAIL" ]]; then
  echo "No Clerk user email resolved. Set CLAUDE_PREVIEW_USER_EMAIL to a" >&2
  echo "@meetcleo.com address that exists in the Clerk dev instance." >&2
  exit 1
fi

TARGET_PATH="${1:-/dashboard}"
PORT="${CLAUDE_PREVIEW_PORT:-3101}"
BASE_URL="http://localhost:${PORT}"

api() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -X "$method" \
    -H "Authorization: Bearer $CLERK_SECRET_KEY" \
    -H "Content-Type: application/json" \
    "https://api.clerk.com/v1${path}" "$@"
}

# URL-encode a string (handles +, &, spaces, etc. so unusual addresses
# don't silently break the Clerk lookup or the ticket URL).
urlencode() {
  jq -rn --arg v "$1" '$v | @uri'
}

echo "→ Looking up Clerk user ($EMAIL)…" >&2
lookup=$(api GET "/users?email_address=$(urlencode "$EMAIL")")
user_id=$(printf '%s' "$lookup" | jq -r '.[0].id // empty')
if [[ -z "$user_id" ]]; then
  echo "User ${EMAIL} not found in Clerk dev instance." >&2
  echo "Users in this instance:" >&2
  api GET "/users?limit=20" | jq -r '.[] | .email_addresses[0].email_address' >&2
  exit 1
fi

echo "→ Creating sign-in token for ${EMAIL} (user_id=${user_id})…" >&2
token_resp=$(api POST "/sign_in_tokens" --data "$(
  jq -n --arg uid "$user_id" '{ user_id: $uid, expires_in_seconds: 3600 }'
)")
token=$(printf '%s' "$token_resp" | jq -r '.token // empty')
if [[ -z "$token" ]]; then
  echo "Failed to create sign-in token:" >&2
  printf '%s\n' "$token_resp" >&2
  exit 1
fi

url="${BASE_URL}/sign-in?__clerk_ticket=${token}&redirect_url=$(urlencode "$TARGET_PATH")"
echo "" >&2
echo "Navigate the preview browser to this URL (1h, single-use):" >&2
echo "" >&2
printf '%s\n' "$url"
