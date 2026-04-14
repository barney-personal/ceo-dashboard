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
| `CANARY_EXPECTED_VALUE` | DOM text string the hourly Playwright canary asserts is rendered | Choose a stable UI element visible after login |
| `CLERK_TEST_TOKEN` | Clerk Testing Token for bypassing login UI in Playwright probes | Clerk dashboard > Testing > Create token |
| `TELEGRAM_FALLBACK_BOT_TOKEN` | Fallback Telegram bot token used by GitHub Actions when the dashboard itself is down | Create a second bot via @BotFather, or reuse `TELEGRAM_BOT_TOKEN` |

## GitHub Actions Secrets

The `.github/workflows/prod-probes.yml` workflow requires these secrets in the repo settings:

- `PROBE_SECRET` — same value as Doppler
- `CEO_DASHBOARD_URL` — same value as Doppler
- `CANARY_EXPECTED_VALUE` — same value as Doppler
- `CLERK_TEST_TOKEN` — same value as Doppler
- `TELEGRAM_BOT_TOKEN` — same value as Doppler
- `TELEGRAM_PROBE_CHAT_ID` — same value as Doppler
- `TELEGRAM_FALLBACK_BOT_TOKEN` — same value as Doppler

## GitHub Actions Workflow

The `.github/workflows/prod-probes.yml` workflow runs production probes on a schedule:

| Job | Schedule | Suite | What it does |
|-----|----------|-------|-------------|
| `probe-15m` | Every 15 min (`*/15 * * * *`) | `ceo-15m-suite` | Hits `/api/probes/ping-auth`, asserts `db_ok: true`, posts result to control plane |
| `probe-60m` | Every hour (`0 * * * *`) | `ceo-60m-suite` | Launches Chromium via Playwright, authenticates with Clerk test token, asserts canary element, captures screenshots on failure |

**Schedule gating:** Both schedules trigger the entire workflow, but each job has an `if:` guard so `probe-15m` only runs on the 15-minute cron (or manual dispatch) and `probe-60m` only runs on the hourly cron (or manual dispatch). At :00, both schedules fire — creating two workflow runs, each executing only its matching job.

The workflow uses `./scripts/probe.sh <suite>` to invoke the probe runner. On probe failure, a Telegram fallback message is sent directly via `TELEGRAM_FALLBACK_BOT_TOKEN` — this fires even when the dashboard itself is down.

Probe reports are uploaded as workflow artifacts (14-day retention). The 60m job also uploads failure screenshots as a separate artifact.

To run manually: trigger from the Actions tab or use `gh workflow run prod-probes.yml`. Manual dispatch runs both jobs.

## Dashboard Canary

The dashboard layout renders a visually-hidden `<span data-testid="probe-canary">` element on every authenticated page. The Playwright hourly probe (M19) navigates to an authenticated page and asserts this element contains the expected value.

- **Source:** `src/components/dashboard/probe-canary.tsx`
- **Location:** `src/app/dashboard/layout.tsx` (rendered after `<main>`)
- **Env var:** `CANARY_EXPECTED_VALUE` — the text content the probe asserts on
- **Default:** `ceo-dashboard-canary-ok` (used when env is unset or empty)
- **Security:** The canary is a static string with no customer data. It uses `aria-hidden="true"` and `sr-only` to stay invisible to sighted users.

To change the canary value, update `CANARY_EXPECTED_VALUE` in both Doppler and GitHub Actions secrets simultaneously.

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
