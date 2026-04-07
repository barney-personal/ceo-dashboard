# CEO Dashboard

Internal company dashboard aggregating data from Mode Analytics, Excel uploads, Slack, Notion, HiBob, and Culture Amp.

## Quick Start

```bash
./scripts/setup.sh          # One-time: configure git hooks
doppler setup               # One-time: connect to Doppler project
doppler run -- npm run dev  # Start dev server with secrets
```

## Architecture

- **Stack:** Next.js 15 + TypeScript + Tailwind CSS + shadcn/ui
- **Auth:** Clerk (Google SSO) with 3-tier roles: `ceo` > `leadership` > `everyone`
- **Database:** PostgreSQL + Drizzle ORM
- **Secrets:** Doppler (never use .env files directly)
- **Hosting:** Render (web service + Postgres + cron)

### Key Directories

```
src/app/                    # Next.js App Router pages
src/app/dashboard/          # Auth-protected dashboard routes
src/lib/auth/roles.ts       # Role model and permission checks
src/lib/db/                 # Drizzle schema and client
src/lib/integrations/       # API clients (Mode, HiBob, Slack, Notion, CultureAmp)
src/lib/sync/               # Data sync logic (parse + upsert)
src/components/dashboard/   # Dashboard UI components
src/components/ui/          # shadcn/ui primitives
```

### Permission Model

| Route | Minimum Role |
|-------|-------------|
| `/dashboard` | everyone |
| `/dashboard/financials/*` | ceo |
| `/dashboard/people/*` | leadership |
| `/dashboard/okrs/*` | everyone |

Role is stored in Clerk `publicMetadata.role`. Default is `everyone`.

## Environment Variables

Managed via **Doppler**. See `.env.example` for the full list (reference only).

```bash
doppler setup                              # One-time config
doppler run -- npm run dev                 # Run with secrets injected
```

**Never hardcode secrets. Never commit `.env`.**

## Testing

```bash
make test
```

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
