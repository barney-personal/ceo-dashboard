# Production probes — design

**Status:** Draft
**Date:** 2026-04-14
**Owner:** Barney
**Target repos:** `ceo-dashboard`, `home-assistant-control`

## Purpose

A self-operating watcher that continuously verifies `ceo-dashboard` and `home-assistant-control` are healthy in production, with a single-command mode (`make probe-all`) that lets Barney — or an agent — fire every probe on demand to validate the world still works after a large refactor.

Two jobs, one system:

1. **Scheduled probes** — 24/7 liveness and correctness checks, alerting to Telegram.
2. **On-demand sweep** — one command, agent-friendly output, idempotent, safe to run during demos.

## In scope

- Black-box production probes for both apps at **L4 rigor** (full journey, realistic traffic).
- Scheduled cadence: 15 min for cheap checks, hourly for expensive ones, daily for disruptive ones.
- One-command ad-hoc mode exposed via `make probe-all` in each repo, plus a top-level combined wrapper.
- Telegram alerting with flap-damping and escalation.
- Status dashboard at `/admin/probes` inside `ceo-dashboard`.

## Out of scope (explicit)

- Probes against other repos in the personal org.
- Auto-remediation (restart, revert, re-deploy).
- Multi-region probing.
- Metrics export (Prometheus, OTEL).
- Staging-environment probes — the CLI accepts `--target=staging` but no staging probes are configured at launch.

## Design decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| 1 | L4 rigor both sides | User requirement — verify what actually matters, not just HTTP 200. |
| 2 | HA: L4c every 15 min, L4d daily at 12:00 | L4c (command injection) catches ~90% of real breakage at near-zero cost. L4d (audio loopback) is scientifically purer but noisy and false-negative-prone — limit to once a day during waking hours. |
| 3 | Split cloud + local checkers | Separates failure domains: if `barneym3` dies, cloud still probes; if ceo-dashboard dies, cloud falls back to direct Telegram. |
| 4 | Control plane inside `ceo-dashboard` | It already has Postgres, Next.js, Clerk, Sentry — the right home for a status page + history tables. HA has neither. |
| 5 | Alerts via Telegram | User already has Telegram MCP configured; push beats pull for outages. |
| 6 | ceo-dashboard auth: 15 min probe endpoints + hourly Playwright+Clerk | Cheap cadence catches most regressions; hourly Playwright catches auth/session drift without burning Clerk quota. |
| 7 | Fully custom (no Checkly/Datadog) | Single-user system; the Checkly polish-per-dollar trade isn't worth the SaaS dependency. Also matches Barney's existing pattern of owning his infra. |
| 8 | Probes co-located with app under test | Each repo is self-contained and testable independently. Control plane (reporting + UI) stays in `ceo-dashboard` because it's the one with a DB + UI. |

## Architecture

```
 ┌──────────────────────────────┐         ┌──────────────────────────────┐
 │  CLOUD PROBE                 │         │  LOCAL PROBE                 │
 │  GitHub Actions scheduled    │         │  Python daemon on barneym3   │
 │  in ceo-dashboard            │         │  launchd timer               │
 │  .github/workflows/probe.yml │         │  in home-assistant-control   │
 │  - 15m cheap probe set       │         │  - 15m L4c command injection │
 │  - 60m Playwright + Clerk    │         │  - Daily 12:00 L4d audio     │
 └─────────────┬────────────────┘         └─────────────┬────────────────┘
               │ POST /api/probes/report                │
               ▼                                        ▼
       ┌─────────────────────────────────────────────────────┐
       │  CONTROL PLANE (inside ceo-dashboard)               │
       │  - /api/probes/report       (ingest; HMAC-signed)   │
       │  - /api/probes/heartbeat    (liveness of probes)    │
       │  - /admin/probes            (Next.js status page)   │
       │  - Postgres: probe_runs, probe_heartbeats           │
       │  - Flap/escalation engine (Drizzle + cron route)    │
       └─────────────┬───────────────────────────────────────┘
                     │
                     ▼
              ┌─────────────────┐
              │  Telegram bot   │
              │  (existing MCP) │
              └─────────────────┘
```

## Components

### 1. Cloud probe — `ceo-dashboard/.github/workflows/prod-probes.yml`

Two jobs, one workflow:

- **`probe-15m`** — cron `*/15 * * * *`:
  - Installs Node + runs `make probe ceo-15m-suite` from repo root.
  - The suite hits `/api/probes/ping-auth` (HMAC-signed), asserts:
    - HTTP 200 in <2s
    - Response body includes `db_ok: true`, `version` populated, `mode_sync_age_hours < 26`
  - Always posts result to `/api/probes/report`, even on failure (so history exists).
  - On failure: attempts direct Telegram via `TELEGRAM_FALLBACK_BOT_TOKEN` (stored as GH secret) in case the control plane is what's down.

- **`probe-60m`** — cron `0 * * * *`:
  - Installs Node + Playwright browsers.
  - Runs `make probe ceo-60m-suite`, which:
    - Uses a Clerk Testing Token to bypass the login UI.
    - Loads `/squads` (or another canary page — TBD in planning).
    - Asserts a known canary value rendered in the DOM.
    - Captures screenshot on failure, uploads as workflow artifact.

### 2. Local probe — `home-assistant-control/probes/`

Python package, launchd-managed:

- **`probes/l4c.py`** (every 15 min):
  - POSTs `{"cmd": "test probe: turn on scene.diagnostic_probe"}` to a new localhost HTTP sidecar running inside the live `voice_agent.py` process (`POST http://127.0.0.1:8765/test/inject`, guarded by `PROBE_SECRET`).
  - The sidecar is a small FastAPI app started on a background thread in `voice_agent.main()`; shares the same pipeline + brain objects as the main wake-word loop. Critical design point: **probe hits the live instance, not a second copy**. If `voice_agent` is dead, the sidecar is dead too — `connection-refused` is the exact signal we want.
  - The endpoint runs `pipeline.run_turn(brain, inline_command=cmd)` against the live MCP allowlist + Claude Code subprocess.
  - Polls HA REST API every 1s up to 10s for `scene.diagnostic_probe` state change.
  - Asserts: entity toggled within 10s AND Claude's response text includes "ok" or "done".
  - `finally` block reverts the scene to known state — always leaves HA clean.
  - POSTs result to ceo-dashboard `/api/probes/report`.

- **`probes/l4d.py`** (daily at 12:00):
  - Plays a WAV of "hey jarvis, probe" through `afplay`.
  - Listens via mic for the agent's response (reuses the existing Azure STT pipeline inverted: probe becomes listener).
  - Asserts response text contains the canary token ("probe acknowledged").
  - Two-strike: on first failure, retries after 5 min; only alerts if both fail.
  - Logs mic RMS on failure for debug.

- **`probes/heartbeat.py`** (every 60s as separate launchd timer):
  - POSTs `{"probe_id": "ha-local"}` to ceo-dashboard `/api/probes/heartbeat`.
  - Cheap; independent of main probes so a hung probe doesn't kill the heartbeat.

### 3. Control plane — `ceo-dashboard/src/app/api/probes/`

- **`POST /api/probes/report`** — HMAC-authenticated. Writes to `probe_runs` (probe_id, check_name, status, latency_ms, details_json, ts). Triggers alerter post-insert.
- **`POST /api/probes/heartbeat`** — HMAC-authenticated. Upserts `probe_heartbeats` (probe_id, last_seen_at).
- **`GET /api/probes/ping-auth`** — the cloud probe's target. Returns:
  ```json
  {
    "version": "abc123",
    "db_ok": true,
    "mode_sync_age_hours": 3.2,
    "deploying": false,
    "ts": "2026-04-14T09:15:00Z"
  }
  ```
- **`GET /admin/probes`** — Clerk-protected Next.js page. Lists per-check:
  - Current status (green/yellow/red).
  - Last 24h timeline.
  - p50/p95 latency sparklines.
  - Last-7-days uptime %.
  - Red events with click-to-expand details.

### 4. Alerter — `ceo-dashboard/src/lib/probes/alerter.ts`

- Invoked from the `/api/probes/report` route handler after insert.
- Reads last 3 `probe_runs` for the same check.
- State machine:
  - `green → red`: fire Telegram (`🚨 {check} failed: {reason}`).
  - `red × 3`: fire escalated Telegram (`⚠️ {check} red for {N} min — still failing`).
  - `red → green`: fire recovery Telegram (`✅ {check} recovered after {N} min`).
  - Subsequent red every 60 min: reminder until acked.
- **Ack mechanism:** simplest viable — on any escalated alert, alerter auto-snoozes reminders for 2 hours. User can also reply to the message with `/ack` in Telegram (handled by a dedicated webhook route `POST /api/telegram/webhook`). Thumbs-up reactions are a nice-to-have, not the primary ack path. Record acks in `probe_incidents.acked_at`.
- Rate limit: max 1 escalation per check per hour.

### 5. Meta-heartbeat watcher — `ceo-dashboard/src/app/api/cron/probe-heartbeat/route.ts`

- Runs every 5 min via a Render **Cron Job** resource (separate from the web service) declared in `render.yaml`. The cron hits the route via HMAC-authenticated localhost-style request.
- Selects probes whose `last_seen_at > 15 min ago`.
- For each: fires "probe itself is offline" Telegram alert via alerter.
- Treated like a red probe run for aggregation purposes.

### 6. CLI + Makefile — in each repo

Each repo exposes:

```bash
make probe-all                       # all checks for this repo
make probe-all --fast                # skip Playwright + audio
make probe-all --target=staging      # different env
make probe-all --read-only           # skip side-effect checks
make probe <name>                    # single named check
```

Under the hood:

- `ceo-dashboard/scripts/probe.ts` — TS CLI using the same probe modules as scheduled jobs. Parses a YAML manifest listing all checks + their handlers.
- `home-assistant-control/probes/cli.py` — Python CLI for HA probes.

Output contract (both CLIs):

- Streams to stdout per-check: `🔄 ceo-ping-auth ... ✅ 312ms`
- Final line is machine-parseable:
  ```
  ✅ probe-all: 8/8 passed in 3m12s | report: .probe-reports/20260414-091532-abc123.md
  ```
- Exit code: `0` all green, `1` any red.
- Writes a timestamped markdown report to `.probe-reports/YYYYMMDD-HHMMSS-<sha>.md`.

### 7. Top-level combined wrapper — `~/GitHub/personal/bin/probe-all`

~20-line bash script:

```bash
#!/usr/bin/env bash
# Runs probe-all in both repos, merges reports, returns combined exit code.
set -e
cd ~/GitHub/personal/ceo-dashboard && make probe-all "$@" &
cd ~/GitHub/personal/home-assistant-control && make probe-all "$@" &
wait
# Combines .probe-reports/ from both into a single timestamped combined report.
```

Agents (Claude Code, Hurlicane) and Barney use this for post-refactor sweeps.

## Database schema (Drizzle)

```ts
probe_runs: {
  id: serial primary key
  probe_id: text                  // "cloud-cron" | "ha-local"
  check_name: text                // "ceo-ping-auth" | "ha-l4c-lights"
  status: enum("green","red","timeout")
  latency_ms: integer
  details_json: jsonb             // free-form debug payload
  run_id: text                    // groups related checks in a sweep
  target: enum("prod","staging")
  ts: timestamp
  INDEX (check_name, ts desc)
}

probe_heartbeats: {
  probe_id: text primary key
  last_seen_at: timestamp
  version: text                   // probe's own git SHA
}

probe_incidents: {
  id: serial primary key
  check_name: text
  opened_at: timestamp
  closed_at: timestamp?
  acked_at: timestamp?
  escalation_level: integer
}
```

## Security

- **HMAC on all report/heartbeat endpoints.** Secret in Doppler (`PROBE_SECRET`) shared between local probe + cloud probe + control plane. Rotation: accept current + previous for 1h grace window.
- **Probe endpoints never expose real user data.** The canary value asserted by Playwright is a deliberately seeded row, not real customer data.
- **`scene.diagnostic_probe` side-effects are no-op.** Sets an `input_boolean` that no automation reads.
- **L4c endpoint `/test/inject`** on `voice_agent.py` — bound to `127.0.0.1` only; probe talks via localhost.
- **Clerk test tokens** stored in GH Actions secret; rotate quarterly.

## Error handling & edge cases

| Edge case | Handling |
|---|---|
| ceo-dashboard itself is down | Cloud probe can't reach `/api/probes/report`. Falls back to **direct Telegram** via `TELEGRAM_FALLBACK_BOT_TOKEN`. |
| Local probe crashes | Missing heartbeat >15 min → meta-watcher fires alert. |
| Clerk test token expires | Hourly Playwright fails with `reason: auth`. Alerter tags it distinctly so it doesn't look like a real outage. |
| `scene.diagnostic_probe` left dirty | `finally` block reverts; on next run probe verifies clean start state and force-resets if dirty. |
| L4d false negative (TV / music playing) | Two-strike retry after 5 min; only alerts if both fail. Mic RMS logged at failure. |
| Probe run times out | 2 min hard cap per check. Row written with `status=timeout`, treated as red. |
| Flap (red/green/red) | Alerter only fires on 3 consecutive same-status transitions. |
| Secret rotation | Control plane accepts current + previous secret for 1h. |
| Probe during deploy | `/api/probes/ping-auth` returns `deploying: true` if within 5 min of last deploy. Probe treats as `degraded-ok`, doesn't fire red. |
| GH Actions cron jitter (±10 min) | Alerter's "stale run" threshold set to 20 min, accommodates jitter without ghost alerts. |
| Cost control | L4c runs `claude -p` locally → ~$0.01/call × 96/day ≈ $30/mo Anthropic spend. L4d adds ~$0.03/day. Budget visible on `/admin/probes`. |

## Testing the probes themselves (meta-testing)

- **Unit tests** — alerter state machine: inject sequences of (green, red, red, red, green) and assert correct Telegram dispatches + rate limits. Target 100% branch coverage on the state machine.
- **Integration tests** — `__test__` mode runs probes against a local fake HA + local Next.js dev server; asserts probe → report → alerter path end-to-end.
- **Chaos drill** — monthly manual checklist: `pkill` local probe, kill ceo-dashboard DB (readonly mode), expire Clerk token, verify each fires the expected alert within SLO.
- **Silence test** — weekly cron runs a "deliberately silent" probe; asserts that "probe not heartbeating" alert fires. Catches the broken-alerter-doesn't-alert class of bug (the hardest class to detect).

## Rollout

1. **Phase 1** — control plane: DB tables, report/heartbeat endpoints, alerter, `/admin/probes`. No probes yet; manually POST to test.
2. **Phase 2** — cloud probe: GH Actions workflow + Playwright, 15m + 60m suites. Alerter wired.
3. **Phase 3** — local probe: `/test/inject` in voice_agent, L4c, heartbeat. launchd plist.
4. **Phase 4** — L4d audio loopback (lowest-priority; ship the rest first).
5. **Phase 5** — top-level `bin/probe-all` wrapper + combined report.
6. **Phase 6** — meta-tests (silence test, chaos drill checklist).

Each phase produces working, shippable state. Don't proceed to the next until the previous is green.

## Open questions (to resolve in planning phase)

1. **Canary value in ceo-dashboard** — what specific page + text does Playwright assert on? (Candidate: a "system canary" metric hard-coded in a seed file.)
2. **L4d wake phrase text** — suggest `"hey jarvis, probe"` with expected response `"probe acknowledged"`. Needs to avoid accidental user triggers.
3. **Telegram bot ID** — does the existing MCP bot have a suitable chat to post to, or does a dedicated `#probes` channel make sense?
4. **Retention** — how long to keep `probe_runs` rows? Default proposal: 90 days, then roll-up to daily aggregates.
5. **`--read-only` exact semantics** — excludes L4c (writes to HA) and any write-path tests. Confirm no other write-path probes planned.
6. **Sidecar port** — `127.0.0.1:8765` chosen arbitrarily. Confirm no conflict with existing services on `barneym3`.
7. **Telegram webhook handler** — do we adopt a real webhook (requires public URL for Telegram → webhook) or stick with auto-snooze-only ack for v1?

## Future extensions (out of scope now)

- Staging probes via `--target=staging`.
- Multi-region cloud probes.
- Auto-remediation (e.g., auto-restart launchd on HA probe death, auto-revert deploy on canary red).
- Prometheus metrics export at `/api/probes/metrics`.
- Probes for other repos in personal org (hurlicane, investor-pipeline, sentry-poller).
