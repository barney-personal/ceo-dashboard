# CEO Dashboard — Architecture Scorecard

_Baseline captured before M1 implementation_

---

## Scores

| Dimension | Score | Target |
|-----------|-------|--------|
| 1. Separation of Concerns | 7/10 | 9+ |
| 2. API Design | 6/10 | 9+ |
| 3. Database Schema Design | 8/10 | 9+ |
| 4. Configuration Management | 7/10 | 9+ |
| 5. Test Coverage | 5/10 | 9+ |

---

## 1. Separation of Concerns — 7/10

### Strengths
- Clean server/client boundary: pure role logic in `roles.ts`; server-only Clerk access in `roles.server.ts`
- Data loaders are correctly separated from pages (`src/lib/data/`)
- Sync pipeline (coordinator → runtime → runners) is layered cleanly
- Charts are client components that receive pre-fetched data as props

### Issues
- **`dashboard/page.tsx` queries the DB directly** — inlines `db.select().from(syncLog)` instead of going through a data loader. Presentation layer should not contain query logic.
- **`cancel/route.ts` bypasses the sync coordinator** — directly updates `syncLog` and `syncPhases` without calling `finalizeSyncRun()`. This means `heartbeatAt` is not set, `leaseExpiresAt` is not cleared, and the status is set to `"error"` rather than `"cancelled"`.
- **`SQUAD_PILLAR_MAP` (183 lines) embedded in `people.ts`** — this is configuration data (squad→pillar mapping) mixed into a data-transformation module. It should live in a dedicated config file.
- **`metrics.ts` mixes formatting utilities with data access** — `formatCurrency`, `formatPercent`, `formatCompact` are exported formatting helpers that have no business sitting alongside async DB queries.

---

## 2. API Design — 6/10

### Strengths
- Auth pattern is consistent: cron via `Authorization: Bearer <CRON_SECRET>`, manual via Clerk session
- Sync routes correctly delegate to coordinator and runtime
- Response shape is documented via types

### Issues
- **`cancel/route.ts` has a bug**: sets `syncLog.status = "error"` instead of `"cancelled"`. A user-initiated cancellation is not an error and should show correctly in the UI.
- **`cancel/route.ts` duplicates auth logic** — inline `currentUser()` + role check instead of calling `authorizeSyncRequest()`.
- **`squads/route.ts` duplicates auth logic** — `requireCeo()` helper is defined inline instead of reusing `authorizeSyncRequest` or a shared helper.
- **No DELETE handler for squads** — only soft-delete via `PUT { isActive: false }`. If the intent is soft-delete only, the route should reject DELETE with 405.
- **Sync route responses are hand-crafted in each handler** — `/api/sync/mode`, `/api/sync/slack`, `/api/sync/management-accounts` each serialize `EnqueueSyncResult` fields manually. A shared `formatEnqueueResult()` helper would prevent drift.

---

## 3. Database Schema Design — 8/10

### Strengths
- Compound indexes on `sync_log` cover both hot query patterns (source+started, source+completed)
- Partial unique index on active sync runs (`sync_log_active_source_idx`) enforces at-most-one-active-run per source at the DB level
- CASCADE delete on `sync_phases` → `sync_log`
- `financial_periods` uses proper `numeric(15,2)` for currency values
- JSONB for flexible data (`modeReportData.data`, `financialPeriods.rawData`)

### Issues
- **No CHECK constraints on enum-like text columns** — `syncLog.status`, `syncLog.source`, `syncLog.trigger`, `okrUpdates.status`, `modeReports.section` are unconstrained text. Bad data can be inserted at the DB level.
- **`squads` missing indexes on `pillar` and `isActive`** — as the table grows, `WHERE is_active = true` scans the whole table.
- **`okrUpdates.squadName` is denormalized** — no foreign key to `squads.name`. Squad renames in the admin UI won't cascade to OKR updates.
- **`financialPeriods.period`** is `text` (`"2026-02"`). ISO format sorts correctly alphabetically, but there's no CHECK constraint enforcing the format.

---

## 4. Configuration Management — 7/10

### Strengths
- All secrets managed via Doppler — no hardcoded credentials
- Mode report tokens centralized in `mode-config.ts`
- Sync intervals and lease durations centralized in `sync/config.ts`

### Issues
- **Mode workspace URL prefix `https://app.mode.com/cleoai/` is hardcoded in 20+ places** — in `mode-config.ts` (chart embeds), page files, etc. Should be a single constant.
- **Slack workspace URL `https://cleo-team.slack.com/archives/` hardcoded in `okrs.ts`** — should be a named constant.
- **`CHARTS_START = new Date("2023-01-01")` in `chart-data.ts`** — magic date with no explanation. Should be a named constant with a comment.
- **`startKey = "2023-01-02"` in `getQuery3Series()`** — a second inconsistently placed magic date in the same file.
- **`30.44` (average days per month) in `people.ts`** — unexplained magic number. Should be a named constant.

---

## 5. Test Coverage — 5/10

### Covered
- `auth/roles.ts` — all role hierarchy cases ✅
- `auth/routes.ts` — route classification ✅
- `sync/config.ts` — queue decision logic ✅
- `sync/mode-storage.ts` — storage window filtering ✅
- `db/errors.ts` — schema error detection ✅
- `components/permission-gate.tsx` — rendering by role ✅
- `components/sync-run-log.tsx` — rendering ✅

### Not Covered
- **`data/people.ts`** — `transformToPersons`, `getPeopleMetrics`, `groupByPillarAndSquad`, `getTenureDistribution`, `getMonthlyJoinersAndDepartures` are all pure functions with no tests.
- **`data/chart-data.ts`** — weekly bucketing, LTV:CAC ratio computation, cohort aggregation — all complex, untested.
- **`data/metrics.ts`** — `formatCurrency`, `formatPercent`, `formatCompact`, `getQueryRow` are pure and testable.
- **`data/okrs.ts`** — `getSlackMessageUrl` and the deduplication logic are pure and untested.
- **`sync/request-auth.ts`** — `isCronRequest` logic is untested.
- **`sync/errors.ts`** — `isSyncCancelledError` is untested.

### Missing Test Categories
1. Pure data-transform functions (people, metrics, chart aggregation)
2. Auth helpers (`isCronRequest` behavior)
3. OKR deduplication logic

---

## Change Log

| Cycle | Dimension | What Changed | New Score |
|-------|-----------|-------------|-----------|
| 0 | All | Initial assessment | See above |
