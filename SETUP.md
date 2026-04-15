# Production Probes — Setup

This document covers the environment variables and secrets required for the production probes system. All secrets are managed via Doppler and GitHub Actions secrets — never hardcode them.

## Doppler Secrets (ceo-dashboard web service)

| Variable | Purpose | Where to get it |
|----------|---------|-----------------|
| `PROBE_SECRET` | HMAC shared secret for signing probe report/heartbeat requests | Generate: `openssl rand -hex 32` |
| `PROBE_SECRET_PREVIOUS` | Previous HMAC secret during rotation (accepted for 1h grace window) | Copy the old `PROBE_SECRET` value here when rotating |
| `INTERNAL_CRON_SECRET` | Bearer token authorizing the Render cron job for the probe-heartbeat watcher | Generate: `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for sending probe alerts | Create via @BotFather on Telegram |
| `TELEGRAM_PROBE_CHAT_ID` | Telegram chat/group ID where probe alerts are delivered | Send a message to the bot, then call `getUpdates` API |

## Doppler Secrets (probe CLI / GitHub Actions)

| Variable | Purpose | Where to get it |
|----------|---------|-----------------|
| `CEO_DASHBOARD_URL` | Public URL of the ceo-dashboard (e.g. `https://ceo-dashboard.onrender.com`) | Render dashboard |
| `TELEGRAM_FALLBACK_BOT_TOKEN` | Fallback Telegram bot token used by GitHub Actions when the dashboard itself is down | Create a second bot via @BotFather, or reuse `TELEGRAM_BOT_TOKEN` |

## GitHub Actions Secrets

The `.github/workflows/prod-probes.yml` workflow requires these secrets in the repo settings:

- `PROBE_SECRET` — same value as Doppler
- `CEO_DASHBOARD_URL` — same value as Doppler
- `TELEGRAM_BOT_TOKEN` — same value as Doppler
- `TELEGRAM_PROBE_CHAT_ID` — same value as Doppler
- `TELEGRAM_FALLBACK_BOT_TOKEN` — same value as Doppler

## GitHub Actions Workflow

The `.github/workflows/prod-probes.yml` workflow runs production probes on a schedule:

| Job | Schedule | Suite | What it does |
|-----|----------|-------|-------------|
| `probe-15m` | Every 15 min (`*/15 * * * *`) | `ceo-15m-suite` | Hits `/api/probes/ping-auth`, asserts `db_ok: true`, posts result to control plane |

The workflow uses `./scripts/probe.sh <suite>` to invoke the probe runner. On probe failure, a Telegram fallback message is sent directly via `TELEGRAM_FALLBACK_BOT_TOKEN` — this fires even when the dashboard itself is down.

Probe reports are uploaded as workflow artifacts (14-day retention).

To run manually: trigger from the Actions tab or use `gh workflow run prod-probes.yml`.

### Previously removed: `probe-60m` (ceo-clerk-playwright)

An hourly Playwright job was removed on 2026-04-15. It navigated to `/dashboard` with a `__clerk_testing_token` cookie expecting to be signed in, but Clerk testing tokens only bypass bot detection — they are not session tokens. Every run was redirected to `/sign-in` and the canary element was never found, producing persistent false-red incidents.

Re-adding an authenticated Playwright probe requires either:

- A dedicated Clerk test user + per-run sign-in token (`POST https://api.clerk.com/v1/sign_in_tokens` → `/sign-in?__clerk_ticket=<token>` to establish a real session), or
- `setupClerkTestingToken()` from the `@clerk/testing` package with a real signed-in session.

## Running Probes

### Locally

Run a single probe suite with the shell wrapper (bypasses GNU Make's option parser):

```bash
./scripts/probe.sh ceo-15m-suite --dry-run          # 15-min suite, dry run (no report posted)
./scripts/probe.sh ceo-15m-suite --target=staging    # Target a staging URL
```

Or via Make (flags passed as variables):

```bash
make probe SUITE=ceo-15m-suite PROBE_FLAGS='--dry-run'
make probe-all PROBE_FLAGS='--dry-run --target=staging'
```

### In CI (GitHub Actions)

The `.github/workflows/prod-probes.yml` workflow runs automatically on cron. To trigger manually:

```bash
gh workflow run prod-probes.yml
```

## Investigating Probe Failures

### Artifacts

| Artifact | Location | Retention | Contents |
|----------|----------|-----------|----------|
| Probe reports | GitHub Actions artifacts → `probe-report-*` | 14 days | JSON results from each check (status, latency, details) |
| Telegram alerts | Configured chat/group | Persistent | Alert, escalation, recovery, and reminder messages |

### What to check

1. **Red probe run** — check the `details_json` field on `probe_runs` (visible at `/dashboard/admin/probes`). The `error` key carries the failure message (e.g. `db_ok: false`, `connection refused`); other keys carry check-specific context.
2. **Stale heartbeat alert** — means a probe runner hasn't posted to `/api/probes/heartbeat` within 15 minutes. Check whether the GitHub Actions workflow is running and whether the dashboard API is reachable.
3. **Escalation (⚠️)** — fires after 3 consecutive red runs. The underlying issue persists — investigate the root cause in the probe details rather than the probe system itself.
4. **Telegram fallback** — if the dashboard itself is down, the GitHub Actions workflow sends a direct Telegram message via `TELEGRAM_FALLBACK_BOT_TOKEN` (separate from the dashboard's alert bot). This fires when the workflow job fails entirely.

### Control-plane routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/probes/report` | POST | HMAC (`PROBE_SECRET`) | Ingests probe run results |
| `/api/probes/heartbeat` | POST | HMAC (`PROBE_SECRET`) | Upserts runner heartbeat |
| `/api/probes/ping-auth` | GET | None (public) | Health check target (returns `db_ok`, `version`, `mode_sync_age_hours`) |
| `/api/cron/probe-heartbeat` | GET | Bearer (`INTERNAL_CRON_SECRET`) | Detects stale heartbeats, triggers alerts and recoveries |

## Render Cron Job

The meta-heartbeat watcher runs as a separate Render Cron Job resource that hits `GET /api/cron/probe-heartbeat` with `Authorization: Bearer <INTERNAL_CRON_SECRET>`. Declare this in `render.yaml`.

## Secret Rotation

To rotate `PROBE_SECRET`:

1. Copy the current `PROBE_SECRET` to `PROBE_SECRET_PREVIOUS` in Doppler
2. Set `PROBE_SECRET` to a new value in Doppler
3. Deploy the dashboard (it now accepts both secrets)
4. Update `PROBE_SECRET` in GitHub Actions secrets
5. After 1 hour, clear `PROBE_SECRET_PREVIOUS` from Doppler

## Database Migration

The probe tables (`probe_runs`, `probe_heartbeats`, `probe_incidents`) are created by the Drizzle migration. Run:

```bash
npx drizzle-kit migrate
```

This runs automatically on deploy via Render's `preDeployCommand`.
