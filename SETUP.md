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
