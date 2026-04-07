# CEO Dashboard

Internal company dashboard aggregating data from multiple sources into a single, role-based view for executive decision-making.

## Data Sources

| Source | Type | Status |
|--------|------|--------|
| Mode Analytics | API | Planned |
| Excel uploads | Manual | Planned |
| Slack | API | Planned |
| Notion | API | Planned |
| HiBob | API | Planned |
| Culture Amp | API | Planned |

## Dashboard Sections

- **Unit Economics** — LTV, CAC, ARPU, retention, payback (Leadership+)
- **Financial** — Management accounts, FP&A (CEO only)
- **Product** — DAU, activation, retention, feature adoption (Leadership+)
- **OKRs** — Company → Pillar → Squad objectives, linked to source metrics (Everyone)
- **People** — Performance and engagement (Leadership+)

## Getting Started

### Prerequisites

- Node.js 20+
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) for secrets management
- A [Clerk](https://clerk.com) account with Google SSO configured

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
# Via Clerk API
curl -X PATCH "https://api.clerk.com/v1/users/{user_id}" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"public_metadata": {"role": "ceo"}}'
```

Available roles: `ceo`, `leadership`, `everyone` (default).

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
- **Auth:** Clerk (Google SSO, role-based access)
- **Secrets:** Doppler
- **Testing:** Vitest, React Testing Library
- **Hosting:** Render (planned)

## Git Workflow

Always work on feature branches. Main is protected by git hooks and Claude Code hooks. See `CLAUDE.md` for full details.
