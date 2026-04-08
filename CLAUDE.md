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
src/app/api/                    # API routes (cron, sync triggers)
src/lib/auth/roles.ts           # Role model (pure functions, client-safe)
src/lib/auth/roles.server.ts    # getCurrentUserRole() (server-only)
src/lib/auth/routes.ts          # Public/protected route classification
src/lib/db/schema.ts            # Drizzle schema (squads, modeReports, okrUpdates, etc.)
src/lib/db/index.ts             # Drizzle client
src/lib/integrations/           # API clients (Mode, Slack, Excel parser, LLM)
src/lib/sync/                   # Data sync logic (Mode, Slack OKRs, management accounts)
src/lib/data/                   # Data loaders (metrics, chart-data, mode)
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

Sync is triggered by a Render cron job (`0 */2 * * *`) hitting `POST /api/cron` with a bearer token. Each source checks its last sync time and skips if the interval hasn't elapsed. Manual sync triggers available at `POST /api/sync/mode` and `POST /api/sync/slack` (CEO or cron-authorized).

### Database Schema

Six tables in `src/lib/db/schema.ts`:

| Table | Purpose |
|-------|---------|
| `squads` | Canonical squad registry (name, pillar, PM, channel) |
| `modeReports` | Mode report definitions (token, section, category) |
| `modeReportData` | Synced query results from Mode (JSONB rows) |
| `okrUpdates` | Parsed OKR updates from Slack (status, metrics, squad) |
| `financialPeriods` | Monthly P&L from Slack Excel files |
| `syncLog` | Audit trail of all sync runs |

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

Managed via **Doppler**. See `.env.example` for the full list (reference only).

```bash
doppler setup                              # One-time config
make dev                                   # Run with secrets injected
```

**Never hardcode secrets. Never commit `.env`.**

### Required

- `DATABASE_URL` — PostgreSQL connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` — Clerk routes

### Active Integrations

- `MODE_API_TOKEN` / `MODE_API_SECRET` / `MODE_WORKSPACE` — Mode Analytics
- `SLACK_BOT_TOKEN` / `SLACK_OKR_CHANNEL_IDS` — Slack API
- `ANTHROPIC_API_KEY` — Claude API for OKR and Excel parsing
- `CRON_SECRET` — Auto-generated on Render for cron auth

### Planned

- `HIBOB_API_TOKEN` / `HIBOB_SERVICE_USER_ID` — HiBob
- `NOTION_API_TOKEN` / `NOTION_OKR_DATABASE_IDS` — Notion
- `CULTUREAMP_API_KEY` — Culture Amp

## Testing

```bash
make test
```

Tests cover: role hierarchy, role extraction, route classification, and PermissionGate component rendering.

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
