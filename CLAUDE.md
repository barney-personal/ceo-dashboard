# CEO Dashboard

Internal company dashboard aggregating data from Mode Analytics, Excel uploads, Slack, Notion, HiBob, and Culture Amp.

## Quick Start

```bash
./scripts/setup.sh          # One-time: configure git hooks
doppler setup               # One-time: connect to Doppler project
make dev                    # Start dev server on port 3100
```

## Architecture

- **Stack:** Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Auth:** Clerk (Google SSO) with 3-tier roles: `ceo` > `leadership` > `everyone`
- **Database:** PostgreSQL + Drizzle ORM
- **Secrets:** Doppler (never use .env files directly)
- **Hosting:** Render (web service + Postgres + cron)
- **Design:** "Paper Folio" — warm editorial light theme, Instrument Serif + DM Sans
- **Charts:** D3.js (LineChart, ColumnChart, BarChart, DivergingBarChart, CohortHeatmap)
- **LLM:** Claude Sonnet 4.6 for OKR parsing and Excel extraction
- **Testing:** Vitest + React Testing Library

### Dashboard Sections

```
Dashboard
├── Overview                    ← role-aware summary of all sections (everyone)
├── Unit Economics              ← Leadership+ (Mode API)
│   ├── LTV:Paid CAC ratio (weekly, 3x guardrail)
│   ├── 36-Month LTV by cohort (column chart)
│   ├── Paid CPA actual vs targets (weekly)
│   ├── Marketing Spend actual vs targets (weekly)
│   └── New Bank Connected Users actual vs targets (weekly)
├── Financial                   ← CEO only (Slack Excel uploads + Mode)
│   ├── Management Accounts (P&L by period)
│   └── Seasonality (Mode embed)
├── Product                     ← Leadership+ (Mode API)
│   ├── DAU / WAU / MAU (toggle cadence)
│   ├── Engagement ratios (WAU/MAU, DAU/MAU)
│   └── Retention cohort heatmap
├── OKRs                        ← Everyone (Slack + Claude LLM parsing)
│   ├── Company level
│   ├── Pillar level (Engineering, Product, Growth, etc.)
│   └── Squad level
├── People                      ← Leadership+ (Mode headcount data)
│   ├── Org (headcount, departments, tenure, joiners/departures)
│   ├── Performance
│   └── Engagement
└── Admin                       ← CEO only
    ├── Data Status (sync pipelines, DB tables, env config)
    └── Squads (squad registry management)
```

### Key Directories

```
src/app/                        # Next.js App Router pages
src/app/dashboard/              # Auth-protected dashboard routes
src/app/api/                    # API routes (cron, sync triggers, squads)
src/lib/auth/roles.ts           # Role model (pure functions, client-safe)
src/lib/auth/roles.server.ts    # getCurrentUserRole() (server-only)
src/lib/auth/routes.ts          # Public/protected route classification
src/lib/config/                 # Shared runtime constants (chart dates, people maps, Slack URLs)
src/lib/db/schema.ts            # Drizzle schema (squads, modeReports, okrUpdates, syncPhases, etc.)
src/lib/db/index.ts             # Drizzle client
src/lib/db/errors.ts            # DB error classification (schema compat, unavailability)
src/lib/integrations/           # API clients (Mode, Slack, Excel parser, LLM)
src/lib/sync/                   # Sync coordinator, runtime, config, errors, helpers
src/lib/data/                   # Data loaders (metrics, chart-data, mode, okrs, people)
src/components/dashboard/       # Dashboard UI components
src/components/charts/          # D3.js chart components
src/components/ui/              # shadcn/ui primitives
scripts/                        # Setup, guard, worktree, and utility scripts
```

### Data Sources & Sync

| Source | Method | Sync Interval | Status |
|--------|--------|---------------|--------|
| Mode Analytics | REST API | Every 4 hours | Active |
| Slack (OKRs) | Conversations API + Claude LLM | Every 2 hours | Active |
| Slack (Management Accounts) | Files API + Claude LLM | Daily | Active |
| HiBob | API | — | Planned |
| Notion | API | — | Planned |
| Culture Amp | API | — | Planned |

Sync is triggered by a Render cron job (`0 */2 * * *`) hitting `GET /api/cron` with a bearer token. The cron handler fans out to all three sources (mode, slack, management-accounts) and skips each source if its interval hasn't elapsed. Manual sync triggers are available at `POST /api/sync/mode`, `POST /api/sync/slack`, and `POST /api/sync/management-accounts` (CEO or cron-authorized). A running sync can be cancelled via `POST /api/sync/cancel` (CEO only).

### Sync Architecture

The sync pipeline is split across focused modules in `src/lib/sync/`:

| Module | Responsibility |
|--------|---------------|
| `config.ts` | Source definitions (intervals, retry windows, lease/budget timeouts), `SyncSource`/`SyncStatus`/`SyncTrigger` types, `evaluateQueueDecision` |
| `coordinator.ts` | DB-level run lifecycle: enqueue, claim (with unique-constraint dedup), heartbeat, finalize, expire abandoned runs |
| `runtime.ts` | Execution layer: claims a queued run, dispatches to the correct runner (mode/slack/management-accounts), enforces deadline, handles cancellation |
| `errors.ts` | `SyncCancelledError`, `SyncDeadlineExceededError`, `SyncControl` interface, `throwIfSyncShouldStop` helper |
| `phase-tracker.ts` | `PhaseTracker` class — writes `syncPhases` rows to record named steps within a sync run |
| `worker-state.ts` | Process-local protection map for active runs; prevents a cancel request from marking a run failed while it is still executing in this process |
| `request-auth.ts` | `requireRole` / `authorizeSyncRequest` — shared auth helpers for API route handlers |
| `response.ts` | `serializeEnqueueSyncResult` — serialises `EnqueueSyncResult` to plain JSON |
| `mode-storage.ts` | Low-level helpers for writing Mode query results to `modeReportData` |
| `mode.ts` | Full Mode sync runner: fetches runs, stores results via mode-storage |
| `slack.ts` | Slack OKR sync runner |
| `management-accounts.ts` | Management accounts (Slack Excel) sync runner |

### Database Schema

Seven tables in `src/lib/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| `squads` | Canonical squad registry (name, pillar, PM, channel) |
| `modeReports` | Mode report definitions (token, section, category) |
| `modeReportData` | Synced query results from Mode (JSONB rows) |
| `okrUpdates` | Parsed OKR updates from Slack (status, metrics, squad) |
| `financialPeriods` | Monthly P&L from Slack Excel files |
| `syncLog` | Audit trail of all sync runs (status, lease, heartbeat, worker ID) |
| `syncPhases` | Named phase steps within a sync run (phase, status, items processed, error) |

### Permission Model

| Route | Minimum Role | Data Sources |
|-------|-------------|--------------|
| `/dashboard` | everyone | Summary of visible sections |
| `/dashboard/unit-economics` | leadership | Mode API (Strategic Finance KPIs, Growth Marketing) |
| `/dashboard/financial` | ceo | Slack Excel uploads + Mode |
| `/dashboard/product` | leadership | Mode API (Active Users, Retention) |
| `/dashboard/okrs` | everyone | Slack + Claude LLM |
| `/dashboard/people` | leadership | Mode (Headcount SSoT) |
| `/dashboard/admin/status` | ceo | Internal sync status |
| `/dashboard/admin/squads` | ceo | Squad registry |

Role is stored in Clerk `publicMetadata.role`, read via `currentUser()` in server components. Default is `everyone`.

**Important:** `roles.ts` contains pure functions safe for client components. `roles.server.ts` contains `getCurrentUserRole()` which uses Clerk's `currentUser()` and must only be imported from server components.

### Sidebar Navigation

Grouped by domain with role-based visibility:

1. **Overview** — Dashboard (everyone)
2. **Performance** — Unit Economics (leadership+), Financial (ceo), Product (leadership+)
3. **Goals** — OKRs (everyone)
4. **Team** — Org (leadership+), Performance (leadership+), Engagement (leadership+)
5. **Admin** — Squads (ceo), Data Status (ceo)

Groups with no visible items for the user's role are hidden entirely.

### Chart Components

All in `src/components/charts/`, built with D3.js:

| Component | Type | Used For |
|-----------|------|----------|
| `LineChart` | Multi-series time-series | CPA, LTV:CAC, spend, users, engagement, margins |
| `ColumnChart` | Vertical bar (date x-axis) | LTV by cohort, active users |
| `BarChart` | Horizontal bar (categorical) | Headcount by department |
| `DivergingBarChart` | Diverging from zero | Joiners vs departures |
| `CohortHeatmap` | Retention triangle | MAU retention by cohort |

All support: Mode link badges, responsive sizing, interactive tooltips.

### Config Modules

Shared runtime constants live in `src/lib/config/` (not environment variables):

| Module | Exports |
|--------|---------|
| `charts.ts` | `CHART_HISTORY_START_DATE`, `CHART_HISTORY_FIRST_FULL_WEEK`, `CHART_HISTORY_START_TS` — chart window bounds |
| `people.ts` | `DAYS_PER_MONTH`, `SQUAD_PILLAR_MAP`, tenure helpers — people metrics constants |
| `slack.ts` | `SLACK_WORKSPACE_URL`, `buildSlackMessageUrl` — Slack deep-link construction |

### Mode Reports

Configured in `src/lib/integrations/mode-config.ts`. Key reports:

| Report | Section | Key Queries |
|--------|---------|-------------|
| Strategic Finance KPIs | unit-economics | 36M LTV, CPA, ARPU, Query 3 (spend/users/CPA daily), Query 4 (monthly LTV estimates) |
| Growth Marketing Performance | unit-economics | LTV:Paid CAC (daily LTV + spend + users), Payback |
| Premium Conversion | unit-economics | Conversion funnels |
| Retention Dashboard | unit-economics | Retention cohorts |
| App Active Users | product | DAU/WAU/MAU daily |
| App Retention | product | Cohort retention triangle |
| Company OKR Dashboard | okrs | ARPU + Margin, User Acquisition |
| Headcount SSoT | people | Employee headcount by department |
| Seasonality Overview | financial | Revenue seasonality |

## Environment Variables

**Doppler is the single source of truth** for secrets in both dev and prod.
Render is downstream — pushed to via a script, not edited directly.

### Local development

```bash
doppler setup                              # One-time: bind to ceo-dashboard/dev
make dev                                   # Run with secrets injected
```

The `make dev` target wraps `doppler run -- npm run dev`, so every command in
the Makefile that touches secrets passes through Doppler. Never create `.env`
files; never commit `.env*`.

### Production (Render)

Workflow:

```
edit secret in Doppler dashboard (ceo-dashboard/prd)
  → RENDER_API_KEY=rnd_... make sync-render-env
  → script PUTs to Render web + sync-worker
  → Render redeploys with new values
```

`scripts/sync-doppler-to-render.py` is idempotent and safe to re-run any time.
It merges Doppler's `prd` secrets into Render's current env, preserving
Render-managed values (`DATABASE_URL` from the `fromDatabase` ref,
`CRON_SECRET` from `generateValue: true`) and only replacing keys that
exist in Doppler.

**Do not add secrets directly in the Render UI.** They'll be silently
overwritten on the next `make sync-render-env`. Add them to Doppler `prd`
and re-sync.

The `RENDER_API_KEY` itself can live in Doppler too — then run
`doppler run -- make sync-render-env` to inject it. To get a fresh key:
Render dashboard → Account Settings → API Keys → Generate.

### What's NOT in Doppler (Render-managed only)

These three live only in `render.yaml` and don't need Doppler entries:

- `DATABASE_URL` — `fromDatabase:` ref auto-resolved by Render at deploy time
- `CRON_SECRET` — Render auto-generates via `generateValue: true`
- `NODE_ENV` — static `"production"` in `render.yaml`

The cron service inherits `CRON_SECRET` and `RENDER_EXTERNAL_URL` from the
web service via `fromService:` refs — also no Doppler entry needed.

### Required keys (Doppler `dev` and `prd`)

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth
  (note: `dev` uses `pk_test_` / `sk_test_`; `prd` should ideally use
  `pk_live_` / `sk_live_` from Clerk's Production environment, though
  test keys also work for an internal-only deploy)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` — Clerk routes

### Active integrations (Doppler `dev` and `prd`)

- `MODE_API_TOKEN` / `MODE_API_SECRET` / `MODE_WORKSPACE` — Mode Analytics
- `SLACK_BOT_TOKEN` / `SLACK_OKR_CHANNEL_IDS` / `SLACK_PRE_READS_CHANNEL_ID` — Slack API
- `ANTHROPIC_API_KEY` — Claude API for OKR and Excel parsing
- `GITHUB_API_TOKEN` / `GITHUB_ORG` / `GITHUB_REPOS` — GitHub engineering metrics
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CALENDAR_ID` — Google Calendar
- `GRANOLA_API_TOKEN` — Granola meeting transcripts
- `SENTRY_AUTH_TOKEN` — Sentry source-map upload (build-time)
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` — Sentry runtime config

### Planned (not yet in Doppler)

- `HIBOB_API_TOKEN` / `HIBOB_SERVICE_USER_ID` — HiBob
- `NOTION_API_TOKEN` / `NOTION_OKR_DATABASE_IDS` — Notion
- `CULTUREAMP_API_KEY` — Culture Amp

### If you (the agent) need to add a new secret

1. `doppler secrets set NEW_KEY="value" --project ceo-dashboard --config dev` (for local)
2. `doppler secrets set NEW_KEY="value" --project ceo-dashboard --config prd` (for prod)
3. Reference it in code via `process.env.NEW_KEY`
4. Run `RENDER_API_KEY=rnd_... make sync-render-env` to push to Render
5. Optionally update the "Active integrations" list above if it's a new system

## Testing

```bash
make test
```

Tests are co-located with their modules in `__tests__/` subdirectories. Current coverage:

| Area | Test files |
|------|-----------|
| Auth | `src/lib/auth/__tests__/roles.test.ts`, `routes.test.ts` |
| Data loaders | `src/lib/data/__tests__/chart-data.test.ts`, `metrics.test.ts`, `mode.test.ts`, `okrs.test.ts`, `people.test.ts`, `sync.test.ts` |
| DB | `src/lib/db/__tests__/errors.test.ts` |
| Integrations | `src/lib/integrations/__tests__/llm-okr-parser.test.ts`, `mode-config.test.ts`, `slack.test.ts` |
| Sync | `src/lib/sync/__tests__/config.test.ts`, `coordinator.test.ts`, `errors.test.ts`, `mode-storage.test.ts`, `request-auth.test.ts`, `runtime.test.ts` |
| API routes | `src/app/api/cron/__tests__/route.test.ts`, `sync/__tests__/manual-routes.test.ts`, `sync/cancel/__tests__/route.test.ts` |

## Git Workflow (MUST follow -- enforced by hooks)

**Never commit or push directly to `main`.** Three layers of protection enforce this:

1. **Claude Code hook** blocks Edit/Write on main (`.claude/settings.json` -> `scripts/guard-branch.sh`)
2. **Git pre-commit hook** blocks `git commit` on main (`.githooks/pre-commit`)
3. **Git pre-push hook** blocks `git push` on main (`.githooks/pre-push`)

The guard-branch hook resolves the target file's git repo to determine the branch — this means worktree edits are correctly allowed even when the main checkout is on `main`.

### Workflow

1. `git checkout -b descriptive-branch-name` -- create a branch **before any edits**
2. Make changes, run tests (`make test`)
3. `git add <specific files>` -- **never use `git add -A`** (risks committing `.claude/worktrees/`, `.env`, etc.)
4. `git commit` then `git push -u origin <branch>` then `gh pr create`
5. Wait for human to merge (do not merge yourself unless explicitly asked)
6. After merge: `git checkout main && git pull` to sync

If the user says "get it live" or "deploy": push branch, create PR, give them the URL.

### Parallel agents MUST use worktrees

Multiple agents in the same checkout will overwrite each other's uncommitted changes. Use the `EnterWorktree` tool (preferred) or the manual script:

```bash
scripts/create-agent-worktree.sh <agent-name> <task-name>
```

Creates a sibling directory with its own branch (`agent/<name>/<task>`). Never run multiple agents in the same directory.

**Important:** Do not `git checkout` a feature branch in the main checkout as a workaround for worktree issues — this moves the main checkout off `main` and affects all other agents.

## Key Conventions

- **Secrets**: Never hardcode. Use Doppler. Never commit `.env`.
- **Staging**: Always `git add <specific files>`. Never `git add -A` or `git add .`.
- **Branches**: Always work on a feature branch. Main is protected at 3 levels.
- **Server vs Client**: Clerk's `currentUser()` is server-only. Keep it in `.server.ts` files. Pure role logic goes in `roles.ts` for shared use.
- **Data flow**: Mode/Slack data is synced to Postgres on a schedule, then read by server components. Never call external APIs directly from pages.
- **Charts**: All charts are client components using D3.js. Data is fetched server-side and passed as props.
- **DB errors**: Use `src/lib/db/errors.ts` helpers (`isSchemaCompatibilityError`, `isDatabaseUnavailableError`, `normalizeDatabaseError`) when catching Postgres errors — do not re-implement pg error code detection inline.
- **Sync auth**: Use `authorizeSyncRequest` from `src/lib/sync/request-auth.ts` in sync route handlers. It handles both cron bearer-token auth and CEO session auth in one call.
