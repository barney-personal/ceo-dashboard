# Code Quality Scorecard

> **Status: frozen historical snapshot.** This scorecard records the code-quality
> audit captured on `2026-04-08T17:26:48Z` and the milestone fixes through M4 on
> the same date. It is intentionally not re-scored as the codebase evolves —
> consult [`ARCHITECTURE-SCORECARD.md`](./ARCHITECTURE-SCORECARD.md) and
> [`RESILIENCE-SCORECARD.md`](./RESILIENCE-SCORECARD.md) for the living views,
> and regenerate counts (tests, lint warnings) with `scripts/doc-status.sh` if
> you want a fresh reading.

Baseline captured: `2026-04-08T17:26:48Z`  
Last-reviewed: `2026-04-18` (freeze confirmed; no content drift)

## Verification Setup

The worktree already has a usable local toolchain (`node_modules` is present), so baseline verification can run directly from the repo root without falling back to a sibling checkout.

Working directory:

```bash
/Users/barneyhussey-yeo/GitHub/personal/.orchestrator-worktrees/ceo-dashboard/wf-d3ccb372
```

Branch:

```bash
workflow/autonomous-agent-run-code-quality-consis-d3ccb372
```

Baseline verification commands:

```bash
make test
npx tsc --noEmit
npx eslint src/
```

Baseline verification results:

| Command | Result | Notes |
| --- | --- | --- |
| `make test` | Pass | `57` tests passed across `7` files |
| `npx tsc --noEmit` | Pass | No type errors reported |
| `npx eslint src/` | Pass with warnings | `3` warnings, `0` errors |

Baseline lint warnings:

- `src/lib/integrations/mode-config.ts:207` defines unused `_syncEnabled` and `_queries`.
- `src/lib/sync/coordinator.ts:10` imports unused `or`.

## Baseline Scores

| Dimension | Score | Why |
| --- | --- | --- |
| Type safety | `8/10` | Strong TS coverage overall, but key data boundaries still leak `unknown` and repeated unchecked casts. |
| Code consistency | `7/10` | Most files are clean, but a few touched modules drift from local conventions for type placement and status normalization. |
| Dead code | `8/10` | Only a few unused imports/destructures remain, but they are real and already visible in lint output. |
| Error handling | `8/10` | Sync flows handle failures, but some modules still use ad hoc logging and message formatting instead of shared helpers. |
| Code duplication | `6/10` | Several small but high-impact patterns are duplicated in sync and chart code, making future fixes easy to miss. |

## Evidence By Dimension

### 1. Type Safety — 8/10

- `src/lib/data/mode.ts:67` returns `Promise<unknown | null>` from `getMetricValue`, which pushes narrowing work downstream.
- `src/lib/data/chart-data.ts:26`, `src/lib/data/chart-data.ts:44`, `src/lib/data/chart-data.ts:153`, `src/lib/data/chart-data.ts:313` rely on repeated `as string` and `as number` casts on report rows.
- `src/lib/data/people.ts:33`, `src/lib/data/people.ts:40`, `src/lib/data/people.ts:87` repeat unchecked casts while shaping headcount rows.
- `src/lib/integrations/excel-parser.ts:22`, `src/lib/integrations/excel-parser.ts:42`, `src/lib/integrations/excel-parser.ts:152` keep wide `unknown[][]` and `JSON.parse` boundaries that are only lightly narrowed.

### 2. Code Consistency — 7/10

- `src/lib/data/chart-data.ts:2` declares `type ChartSeries` between import statements instead of keeping the import block contiguous.
- `src/lib/data/people.ts:85` and `src/lib/data/people.ts:303` compare `lifecycle_status` using mixed literal casing instead of one normalization path.
- `src/lib/sync/management-accounts.ts:190` and `src/lib/sync/management-accounts.ts:202` use ad hoc console logging and inline error formatting instead of the shared sync helper already available in `src/lib/sync/coordinator.ts:48`.

### 3. Dead Code — 8/10

- `src/lib/sync/coordinator.ts:10` imports `or` but never uses it.
- `src/lib/integrations/mode-config.ts:207` strips `syncEnabled` and `queries` by destructuring into `_syncEnabled` and `_queries`, which are both intentionally unused and flagged by ESLint.

### 4. Error Handling — 8/10

- `src/lib/sync/management-accounts.ts:202` formats errors inline with `error instanceof Error ? error.message : String(error)` instead of reusing `formatSyncError`.
- `src/lib/sync/slack.ts:293` and `src/lib/sync/mode.ts:184` repeat the same inline error-message formatting, which makes the logging surface harder to keep consistent.
- `src/lib/sync/management-accounts.ts:190` and `src/lib/sync/management-accounts.ts:206` mix success/error console calls directly inside the sync loop rather than following one structured reporting pattern.

### 5. Code Duplication — 6/10

- `src/lib/sync/slack.ts:149` and `src/lib/sync/slack.ts:166` duplicate the same RAG-to-status mapping in both the insert and conflict-update paths.
- `src/lib/data/chart-data.ts:53` computes Monday week keys inline, and similar date-bucketing logic appears again in `src/lib/data/chart-data.ts:306` during monthly aggregation.
- `src/lib/sync/management-accounts.ts:216`, `src/lib/sync/mode.ts:329`, and `src/lib/sync/slack.ts:307` each determine final sync status from the same `errors.length` / partial-success pattern instead of using one helper.

## Final Scores (after M1–M4)

| Dimension | Baseline | Final | Change |
| --- | --- | --- | --- |
| Type safety | `8/10` | `9/10` | +1 |
| Code consistency | `7/10` | `9/10` | +2 |
| Dead code | `8/10` | `9/10` | +1 |
| Error handling | `8/10` | `9/10` | +1 |
| Code duplication | `6/10` | `9/10` | +3 |

### Final Evidence

**Type safety — 9/10**

Three typed row-accessor helpers (`rowStr`, `rowNum`, `rowNumOrNull`) were added to `src/lib/data/mode.ts` and used throughout `src/lib/data/chart-data.ts` and `src/lib/data/people.ts`. All ~25 unchecked `as string` / `as number` / `as string | null` casts on report rows are replaced with validated accessors that return safe fallback values (`""` / `0` / `null`). Remaining unchecked casts (`r.columns as Array<…>` and `r.data as Record<string, unknown>[]` in `mode.ts`) are unavoidable JSONB-to-application boundary casts from Drizzle, which is the narrowest safe point for this project's schema.

**Code consistency — 9/10**

`ChartSeries` type is now declared below the import block (M3). Lifecycle status comparisons are normalized to `.toLowerCase() !== "terminated"` (M3). Error formatting uses `formatSyncError()` throughout all sync modules (M3). Row accessors are consistent across `chart-data.ts` and `people.ts`.

**Dead code — 9/10**

Unused `or` import removed from `coordinator.ts` (M2). Warning-prone destructuring in `mode-config.ts` replaced with typed projection helper (M2). ESLint runs clean with zero warnings.

**Error handling — 9/10**

All sync runners use `formatSyncError()` for error message formatting (M3). Phase-tracker and `logModeEvent` are the single reporting path — redundant bare `console.log`/`console.error` calls removed (M3). No uncaught error paths in the sync stack.

**Code duplication — 9/10**

`ragToStatus()` extracted in `slack.ts` (M2). `determineSyncStatus()` shared across all three sync runners (M2). `toMondayKey()` extracted in `chart-data.ts` (M2). `formatSyncError()` shared across all sync modules (M3). Row accessor helpers (`rowStr`, `rowNum`, `rowNumOrNull`) eliminate the per-field cast pattern repeated across `chart-data.ts` (20+ casts) and `people.ts` (10+ casts) (M4).

### Final Verification (post-M4)

| Command | Result | Notes |
| --- | --- | --- |
| `make test` | Pass | `57` tests passed across `7` files |
| `npx tsc --noEmit` | Pass | No type errors reported |
| `npx eslint src/` | Pass | `0` warnings, `0` errors |
