# CEO Dashboard

Internal company dashboard aggregating data from multiple sources into a single, role-based view for executive decision-making.

## Data Sources

| Source | Type | Sync Interval | Status |
|--------|------|---------------|--------|
| Mode Analytics | REST API | Every 4 hours | Active |
| Slack (OKRs) | Conversations API + Claude LLM | Every 2 hours | Active |
| Slack (Management Accounts) | Files API + Claude LLM | Daily | Active |
| HiBob | API | — | Planned |
| Notion | API | — | Planned |
| Culture Amp | API | — | Planned |

## Dashboard Sections

- **Overview** — Role-aware summary with hero metrics (Everyone)
- **Unit Economics** — LTV:CAC ratio, LTV by cohort, CPA, spend, user acquisition with targets (Leadership+)
- **Financial** — Management accounts P&L by period, seasonality (CEO only)
- **Product** — DAU/WAU/MAU, engagement ratios, retention cohort heatmap (Leadership+)
- **OKRs** — Company/pillar/squad objectives parsed from Slack via Claude LLM (Everyone)
- **People** — Org structure, headcount, tenure, joiners/departures, performance, engagement (Leadership+)
- **Admin** — Data sync status, squad registry management (CEO only)

## Getting Started

### Prerequisites

- Node.js 20+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) for secrets management
- A [Clerk](https://clerk.com) account with Google SSO configured
- PostgreSQL database (provisioned via Render or local)

### Setup

```bash
git clone git@github.com:barney-personal/ceo-dashboard.git
cd ceo-dashboard
./scripts/setup.sh
doppler setup
npm install
make dev
```

The app runs on `http://localhost:3100`.

### Setting User Roles

Roles are managed in Clerk. Set a user's role via the Clerk dashboard or API:

```bash
curl -X PATCH "https://api.clerk.com/v1/users/{user_id}" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"public_metadata": {"role": "ceo"}}'
```

Available roles: `ceo`, `leadership`, `everyone` (default).

### Database

```bash
make db-push          # Push schema to database
make db-migrate       # Generate migration files
make db-studio        # Open Drizzle Studio
```

## Development

```bash
make dev          # Start dev server (port 3100, via Doppler)
make build        # Production build
make lint         # ESLint
make type-check   # TypeScript check
make test         # Run test suite
```

## Tech Stack

- **Framework:** Next.js 16, TypeScript, Tailwind CSS 4
- **UI:** shadcn/ui, Instrument Serif + DM Sans typography
- **Charts:** D3.js (line, column, bar, diverging bar, cohort heatmap)
- **Auth:** Clerk (Google SSO, 3-tier role-based access)
- **Database:** PostgreSQL + Drizzle ORM
- **LLM:** Anthropic Claude Sonnet 4.6 (OKR parsing, Excel extraction)
- **Secrets:** Doppler
- **Testing:** Vitest, React Testing Library
- **Hosting:** Render (web service + Postgres + cron job)

## Architecture

Data flows through a sync-first pipeline:

1. **Cron job** (every 2 hours) triggers `POST /api/cron`
2. **Sync modules** pull from Mode, Slack, and Excel files
3. **Data stored** in PostgreSQL via Drizzle ORM
4. **Server components** read from DB and pass data to chart components
5. **Client components** render D3.js charts with interactive tooltips

## Git Workflow

Always work on feature branches. Main is protected by three layers:
- Claude Code hook (blocks Edit/Write on main)
- Git pre-commit hook (blocks commits on main)
- Git pre-push hook (blocks pushes on main)

See `CLAUDE.md` for full workflow details.
