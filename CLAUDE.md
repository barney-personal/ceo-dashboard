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
- **Database:** PostgreSQL + Drizzle ORM (planned)
- **Secrets:** Doppler (never use .env files directly)
- **Hosting:** Render (web service + Postgres + cron)
- **Design:** "Paper Folio" — warm editorial light theme, Instrument Serif + DM Sans
- **Testing:** Vitest + React Testing Library

### Dashboard Sections

```
Dashboard
├── Overview                    ← role-aware summary of all sections
├── Unit Economics              ← Leadership+ (Mode API)
│   ├── LTV (ARPU, retention, lifetime)
│   └── CAC (spend by channel, conversion, payback)
├── Financial                   ← CEO only (Excel uploads + Mode)
│   ├── Management Accounts
│   └── FP&A
├── Product                     ← Leadership+ (Mode dashboards)
│   └── DAU, activation, retention, feature adoption
├── OKRs                        ← Everyone (Notion + Slack + Mode)
│   ├── Company level
│   ├── Pillar level
│   └── Squad level
│   (Key results link to source metrics in other sections)
└── People                      ← Leadership+ (HiBob + Culture Amp)
    ├── Performance
    └── Engagement
```

OKRs are a cross-cutting goal layer — they reference metrics in other sections rather than duplicating them.

### Key Directories

```
src/app/                        # Next.js App Router pages
src/app/dashboard/              # Auth-protected dashboard routes
src/lib/auth/roles.ts           # Role model (pure functions, client-safe)
src/lib/auth/roles.server.ts    # getCurrentUserRole() (server-only)
src/lib/auth/routes.ts          # Public/protected route classification
src/lib/db/                     # Drizzle schema and client (planned)
src/lib/integrations/           # API clients (planned)
src/lib/sync/                   # Data sync logic (planned)
src/components/dashboard/       # Dashboard UI components
src/components/ui/              # shadcn/ui primitives
```

### Permission Model

| Route | Minimum Role | Data Sources |
|-------|-------------|--------------|
| `/dashboard` | everyone | Summary of visible sections |
| `/dashboard/unit-economics` | leadership | Mode API |
| `/dashboard/financial` | ceo | Excel uploads + Mode |
| `/dashboard/product` | leadership | Mode API |
| `/dashboard/okrs` | everyone | Notion + Slack + Mode |
| `/dashboard/people` | leadership | HiBob + Culture Amp |

Role is stored in Clerk `publicMetadata.role`, read via `currentUser()` in server components. Default is `everyone`.

**Important:** `roles.ts` contains pure functions safe for client components. `roles.server.ts` contains `getCurrentUserRole()` which uses Clerk's `currentUser()` and must only be imported from server components.

### Sidebar Navigation

Grouped by domain: Overview, Performance (Unit Economics + Financial + Product), Goals (OKRs), Team (People). Groups with no visible items for the user's role are hidden.

## Environment Variables

Managed via **Doppler**. See `.env.example` for the full list (reference only).

```bash
doppler setup                              # One-time config
make dev                                   # Run with secrets injected
```

**Never hardcode secrets. Never commit `.env`.**

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

### Workflow

1. `git checkout -b descriptive-branch-name` -- create a branch **before any edits**
2. Make changes, run tests (`make test`)
3. `git add <specific files>` -- **never use `git add -A`** (risks committing `.claude/worktrees/`, `.env`, etc.)
4. `git commit` then `git push -u origin <branch>` then `gh pr create`
5. Wait for human to merge (do not merge yourself unless explicitly asked)
6. After merge: `git checkout main && git pull` to sync

If the user says "get it live" or "deploy": push branch, create PR, give them the URL.

### Parallel agents MUST use worktrees

Multiple agents in the same checkout will overwrite each other's uncommitted changes:

```bash
scripts/create-agent-worktree.sh <agent-name> <task-name>
```

Creates a sibling directory with its own branch (`agent/<name>/<task>`). Never run multiple agents in the same directory.

## Key Conventions

- **Secrets**: Never hardcode. Use Doppler. Never commit `.env`.
- **Staging**: Always `git add <specific files>`. Never `git add -A` or `git add .`.
- **Branches**: Always work on a feature branch. Main is protected at 3 levels.
- **Server vs Client**: Clerk's `currentUser()` is server-only. Keep it in `.server.ts` files. Pure role logic goes in `roles.ts` for shared use.
