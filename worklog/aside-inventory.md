# A-Side Engineering Inventory

Catalogued on 2026-04-24 from branch `workflow/engineering-section-v2-radical-simplific-b9b651e7` after merging 69 commits from `origin/main` (up to `b9f9924`). Corrected on 2026-04-24 (cycle 2, M2) against the real module imports and auth calls.

## Pages

| # | URL | File | Role Gate | Data Loaders | B-side Reuse? |
|---|-----|------|-----------|--------------|---------------|
| 1 | `/dashboard/engineering` | `page.tsx` | (no check — 302 redirect) | N/A (redirects to `/dashboard/engineering/delivery-health`) | N/A |
| 2 | `/dashboard/engineering/delivery-health` | `delivery-health/page.tsx` | `dashboard.engineering` (default `everyone`) | `getDoraScorecard`, `getDoraTrend`, `getPillarWeeklyTrend`, `getSquadLeaderboard`, `computePillarMovers`, `classify{DeployFrequency,ChangeLeadTime,ChangeFailureRate,Mttr}` — all from `src/lib/data/swarmia.ts` | Reusable |
| 3 | `/dashboard/engineering/engineers` | `engineers/page.tsx` | `dashboard.engineering` (default `everyone`) | `getEngineeringRankings`, `PERIOD_OPTIONS` from `src/lib/data/engineering.ts`; `getLatestTerminalSyncRun` from `src/lib/data/mode.ts` | Reusable |
| 4 | `/dashboard/engineering/engineers/[login]` | `engineers/[login]/page.tsx` | `dashboard.engineering` (default `everyone`); CEO-only performance ratings section; eng_manager+ or self for code review section | `getEngineerProfile`, `getEngineerTimeSeries`, `getSquadOkrs`, `getEngineerPerformanceRatings`, `getEmployeeOptions`, `getEngineerAiUsage` from `src/lib/data/engineer-profile.ts`; `getEngineerCodeReview` from `src/lib/data/code-review.ts`; `PERIOD_OPTIONS` from `src/lib/data/engineering.ts`; `resolveViewerEmail` from `src/lib/data/managers.ts` | Reusable with role scoping |
| 5 | `/dashboard/engineering/pillars` | `pillars/page.tsx` | `dashboard.engineering` (default `everyone`) | `getEngineeringRankings`, `PERIOD_OPTIONS` from `src/lib/data/engineering.ts`; `getSquadPillarMetrics`, `periodDaysToSwarmiaTimeframe` from `src/lib/data/swarmia.ts` | Reusable |
| 6 | `/dashboard/engineering/squads` | `squads/page.tsx` | `dashboard.engineering` (default `everyone`) | same as `pillars/page.tsx` | Reusable |
| 7 | `/dashboard/engineering/impact` | `impact/page.tsx` | `engineering.impact` (default `everyone`); individual fields scrubbed for non-leadership | `getImpactAnalysis` from `src/lib/data/engineering-impact.ts` | Reusable with scrubbing |
| 8 | `/dashboard/engineering/impact-model` | `impact-model/page.tsx` | `engineering.impactModel` (default `manager`) | `getImpactModelHydrated`, `buildTeamView` from `src/lib/data/impact-model.server.ts`; `getAllManagers`, `isManagerByEmail`, `resolveViewerEmail` from `src/lib/data/managers.ts` | Fork required |
| 9 | `/dashboard/engineering/code-review` | `code-review/page.tsx` | `engineering.codeReview` (default `engineering_manager`) | `getCodeReviewPageData` from `src/lib/data/code-review.ts` | Fork required |
| 10 | `/dashboard/engineering/ranking` | `ranking/page.tsx` | `engineering.ranking` (default `engineering_manager`) | `getEngineeringRankingPageData` from `src/lib/data/engineering-ranking.server.ts`; `getRequiredRoleForDashboardPermission` from `src/lib/auth/dashboard-permissions.server.ts` | Fork required |
| 11 | `/dashboard/engineering/ranking/methodology` | `ranking/methodology/page.tsx` | `engineering.ranking` (default `engineering_manager`) | `getEngineeringRankingPageData` from `src/lib/data/engineering-ranking.server.ts` | Fork required |
| 12 | `/dashboard/engineering/ranking/hr-review` | `ranking/hr-review/page.tsx` | `engineering.ranking.hr` (default `engineering_manager`) | `getEngineeringRankingPageData`, `getHrAuxiliaryData` from `src/lib/data/engineering-ranking.server.ts`; `buildHrEvidencePack` from `src/lib/data/engineering-ranking-hr.ts` | Fork required |

## Layout and Navigation

**Layout** (`src/app/dashboard/engineering/layout.tsx`): wraps all pages, calls `getCurrentUserRole()` and `getDashboardPermissionRoleMap()`, renders `EngineeringTabs` with conditional tab visibility based on role. The root `/dashboard/engineering` calls `redirect(...)` — no auth check on the root; access is gated by the target page.

**EngineeringTabs** (`src/components/dashboard/engineering-tabs.tsx`): client component.
- Base tabs (always visible): Delivery Health, Pillars, Squads, Engineers
- Conditional tabs: Impact (`showImpact`), Impact model (`showImpactModel`), Code review (`showCodeReview`), Ranking (`showRanking`)
- Period picker shown on: Engineers, Pillars, Squads (hidden on Delivery Health, Impact, Impact model, Code review, Ranking)

## Dashboard Permission IDs

From `src/lib/auth/dashboard-permissions.ts`:

| Permission ID | Default Role | Editable via Admin |
|---------------|-------------|-------------------|
| `dashboard.engineering` | everyone | Yes |
| `engineering.impact` | everyone | Yes |
| `engineering.impactModel` | manager | Yes |
| `engineering.codeReview` | engineering_manager | Yes |
| `engineering.ranking` | engineering_manager | Yes |
| `engineering.ranking.hr` | engineering_manager | Yes |

## Data Loaders

Corrected to reflect actual module imports used by A-side pages.

| Module | Key Exports | Used By |
|--------|-------------|---------|
| `src/lib/data/engineering.ts` | `getEngineeringRankings`, `PERIOD_OPTIONS`, `PeriodDays`, `computeImpact` (re-exported from `engineering-metrics.ts`) | Engineers, Pillars, Squads, Profile |
| `src/lib/data/engineer-profile.ts` | `getEngineerProfile`, `getEngineerTimeSeries`, `getSquadOkrs`, `getEngineerPerformanceRatings`, `getEngineerAiUsage`, `getEmployeeOptions` | Engineer profile page |
| `src/lib/data/mode.ts` | `getLatestTerminalSyncRun` (and others) | Engineers (latest-sync badge), Admin Status |
| `src/lib/data/swarmia.ts` | `getDoraScorecard`, `getDoraTrend`, `getPillarWeeklyTrend`, `getSquadLeaderboard`, `getSquadPillarMetrics`, `periodDaysToSwarmiaTimeframe`, `classifyDeployFrequency`, `classifyChangeLeadTime`, `classifyChangeFailureRate`, `classifyMttr`, `computePillarMovers`, `normalizeTeamName` | Delivery Health, Pillars, Squads |
| `src/lib/data/engineering-impact.ts` | `getImpactAnalysis`, `ImpactAnalysis` type | Impact page |
| `src/lib/data/impact-model.ts` | Impact model client-safe types/constants (and `IMPACT_MODEL_HASH_KEY` consumers) | Impact model client components |
| `src/lib/data/impact-model.server.ts` | `getImpactModelHydrated`, `buildTeamView`, `TeamView` type | Impact model page |
| `src/lib/data/managers.ts` | `isManagerByEmail`, `isManagerByAnyEmail`, `getDirectReportCountByAnyEmail`, `resolveViewerEmail`, `getDirectReports`, `getEmployeeSummariesByEmail`, `getAllManagers`, `ManagerInfo` type | Impact model, Engineer profile, Managers page |
| `src/lib/data/code-review.ts` | `getCodeReviewPageData`, `getCodeReviewView`, `getEngineerCodeReview`, `rollupSquadsFromEngineers`, `percentileRank` | Code Review, Engineer profile |
| `src/lib/data/engineering-ranking.ts` | Pure math + constants: `RANKING_METHODOLOGY_VERSION`, composite/tenure/percentile helpers, `classifyDiscipline`, `isRankableDiscipline` | Ranking math, Engineering rankings loader |
| `src/lib/data/engineering-ranking.server.ts` | `getEngineeringRankingPageData`, `getEngineeringRankingSnapshot`, `getEngineeringRankingSnapshotWithSignals`, `getHrAuxiliaryData`, `persistRankingSnapshot`, `readRankingSnapshot`, `listRankingSnapshotSlices`, `fetchPriorSnapshotRowsForMovers` | Ranking page, Methodology page, HR Review page, Snapshot API |
| `src/lib/data/engineering-ranking-hr.ts` | `buildHrEvidencePack`, `classifyHrVerdict`, `formatOrdinal` | HR Review page |

## API Routes

Corrected to reflect actual authorization in route handlers.

| Route | Method | Role Gate | Purpose |
|-------|--------|-----------|---------|
| `/api/engineering-ranking/snapshot` | POST | CEO (`requireRole("ceo")`) | Persist ranking snapshot with signals |
| `/api/engineering-ranking/snapshot` | GET | CEO (`requireRole("ceo")`) | Fetch snapshot by `?date=YYYY-MM-DD` or list slices |
| `/api/sync/code-review` | POST | Cron (`Bearer CRON_SECRET`) OR manual user with `engineering.codeReview` permission (default role `engineering_manager`, admin-editable) — via `authorizeSyncRequest(request, "engineering.codeReview")`. **Not CEO-only.** | Trigger a code-review analysis run over last 90d merged PRs |
| `/api/sync/github` | POST | Cron OR manual user with default engineering sync permission (`authorizeSyncRequest(request)` with no permission ID → falls back to default manual-sync role) | Enqueue a GitHub PR/commit sync run |
| `/api/github-mapping` | PUT | CEO (`requireRole("ceo")`) | Upsert a GitHub login → employee-email mapping; used by `EditMappingDialog` on the engineer profile page. Supports clearing via `employeeEmail: null`. |

Other sync routes under `/api/sync/*` exist (`mode`, `slack`, `management-accounts`, `slack-members`, `meetings`, `cancel`) but do not drive engineering-section content directly.

## Components (A-side)

| Component | File | Used By |
|-----------|------|---------|
| `EngineeringTabs` | `src/components/dashboard/engineering-tabs.tsx` | Layout |
| `EngineeringTable` | `src/components/dashboard/engineering-table.tsx` | Engineers |
| `EngineerTopMetrics` | `src/components/dashboard/engineer-top-metrics.tsx` | Engineers, Pillars, Squads |
| `EngineeringSquadView` | `src/components/dashboard/engineering-squad-view.tsx` | Pillars, Squads |
| `EngineeringFilters` | `src/components/dashboard/engineering-filters.tsx` | Multiple |
| `EngineerProfileCharts`, `EngineerOkrCard`, `EngineerPerformanceCard`, `EngineerAiUsageCard`, `EditMappingDialog` | `src/components/dashboard/*` | Engineer profile |
| `EngineerCodeReviewSection` | `engineers/[login]/_components/engineer-code-review-section.tsx` | Engineer profile |
| `DoraScorecardCard`, `PillarMoversPanel`, `PillarTrendGrid` | `src/components/dashboard/*` | Delivery Health |
| `ImpactReport` | `impact/_components/impact-report.tsx` | Impact |
| `ImpactModelReport`, `ShapWaterfall`, `OutlierTable`, `TeamView` | `impact-model/_components/*` | Impact model |
| `CodeReviewReport` | `code-review/_components/code-review-report.tsx` | Code review |
| `MainScaffold` | `ranking/_components/main-scaffold.tsx` | Ranking |
| `MethodologyScaffold` | `ranking/_components/methodology-scaffold.tsx` | Methodology |
| `HrReviewSection` | `ranking/_components/hr-review-section.tsx` | HR Review |
| `CompositeTable` | `ranking/_components/composite-table.tsx` | Ranking |
| Shared helpers | `_shared.tsx`, `ranking/_components/shared.tsx`, `ranking/_components/sections.tsx` | Delivery Health, Ranking |

## Summary

**Total pages:** 12 (including root redirect and 3 ranking sub-pages)
**Total conditional tabs:** 4 (Impact, Impact model, Code review, Ranking)
**Total data loaders:** 11 modules directly imported by A-side engineering pages
**Total API routes directly tied to the engineering section:** 3 (`/api/engineering-ranking/snapshot` POST/GET, `/api/sync/code-review` POST, `/api/github-mapping` PUT). Plus `/api/sync/github` POST for the upstream sync.

**Reusability breakdown:**
- Fully reusable (no changes for B-side): 5 pages (Delivery Health, Engineers, Pillars, Squads, root redirect)
- Reusable with role scoping: 2 pages (Impact, Engineer Profile)
- Fork required: 5 pages (Impact Model, Code Review, Ranking, Methodology, HR Review)

B-side target: collapse all 12 pages into 1 root surface with 2 persona renderings (Engineer view, Manager view). This represents a reduction from 12 pages + 8 tabs + period picker + multiple filters to 1 page + 2 views.

## Corrections log (2026-04-24, cycle 2, M2)

Corrected placeholder and misattributed module references recorded in the cycle-1 inventory:

- Engineer profile loaders (`getEngineerProfile`, `getEngineerTimeSeries`, `getSquadOkrs`, `getEngineerPerformanceRatings`, `getEngineerAiUsage`, `getEmployeeOptions`) live in `src/lib/data/engineer-profile.ts` (not `engineering.ts`).
- `getEngineerCodeReview` and `getCodeReviewPageData` live in `src/lib/data/code-review.ts` (not `engineering.ts`).
- DORA / Swarmia loaders live in `src/lib/data/swarmia.ts` (not `engineering-swarmia.ts`); placeholder name removed.
- Ranking loaders live in `src/lib/data/engineering-ranking.ts`, `engineering-ranking.server.ts`, and `engineering-ranking-hr.ts` (not `engineering-composite.ts`).
- Impact model manager scoping uses `src/lib/data/managers.ts` (`getAllManagers`, `isManagerByEmail`, `resolveViewerEmail`) alongside `impact-model.server.ts` (`getImpactModelHydrated`, `buildTeamView`).
- Engineers page uses `getLatestTerminalSyncRun` from `src/lib/data/mode.ts` for the last-synced badge.
- `/api/sync/code-review` POST authorizes via `authorizeSyncRequest(request, "engineering.codeReview")` — cron bearer OR a manual user with the editable `engineering.codeReview` permission (default role `engineering_manager`). Previously listed as CEO-only.
- Added `/api/github-mapping` PUT (CEO-only) which backs `EditMappingDialog`.
- Added `/api/sync/github` POST (cron or manual sync user) for the upstream engineering GitHub sync path.
