# A-Side Engineering Inventory

Catalogued on 2026-04-24 from branch `workflow/engineering-section-v2-radical-simplific-b9b651e7` after merging 69 commits from `origin/main` (up to `b9f9924`).

## Pages

| # | URL | File | Role Gate | Data Loaders | B-side Reuse? |
|---|-----|------|-----------|--------------|---------------|
| 1 | `/dashboard/engineering` | `page.tsx` | everyone | N/A (redirect to delivery-health) | N/A |
| 2 | `/dashboard/engineering/delivery-health` | `delivery-health/page.tsx` | everyone (`dashboard.engineering`) | `getDoraScorecard`, `getDoraTrend`, `getPillarWeeklyTrend`, `getSquadLeaderboard` (Swarmia) | Reusable |
| 3 | `/dashboard/engineering/engineers` | `engineers/page.tsx` | everyone | `getEngineeringRankings`, `getLatestTerminalSyncRun` | Reusable |
| 4 | `/dashboard/engineering/engineers/[login]` | `engineers/[login]/page.tsx` | everyone (CEO sees perf ratings; eng_manager+ sees code-review for all; self sees own) | `getEngineerProfile`, `getEngineerTimeSeries`, `getSquadOkrs`, `getEngineerPerformanceRatings`, `getEngineerAiUsage`, `getEngineerCodeReview`, `getEmployeeOptions` | Reusable with role scoping |
| 5 | `/dashboard/engineering/pillars` | `pillars/page.tsx` | everyone | `getEngineeringRankings`, `getSquadPillarMetrics` | Reusable |
| 6 | `/dashboard/engineering/squads` | `squads/page.tsx` | everyone | `getEngineeringRankings`, `getSquadPillarMetrics` | Reusable |
| 7 | `/dashboard/engineering/impact` | `impact/page.tsx` | everyone (`engineering.impact`, default everyone) | `getImpactAnalysis` (scrubbed for non-leadership) | Reusable with scrubbing |
| 8 | `/dashboard/engineering/impact-model` | `impact-model/page.tsx` | manager+ (`engineering.impactModel`, default manager) | `getImpactModelHydrated`, `getAllManagers`, `buildTeamView` | Fork required |
| 9 | `/dashboard/engineering/code-review` | `code-review/page.tsx` | engineering_manager+ (`engineering.codeReview`) | `getCodeReviewPageData` | Fork required |
| 10 | `/dashboard/engineering/ranking` | `ranking/page.tsx` | engineering_manager+ (`engineering.ranking`) | `getEngineeringRankingPageData` | Fork required |
| 11 | `/dashboard/engineering/ranking/methodology` | `ranking/methodology/page.tsx` | engineering_manager+ (`engineering.ranking`) | `getEngineeringRankingPageData` | Fork required |
| 12 | `/dashboard/engineering/ranking/hr-review` | `ranking/hr-review/page.tsx` | engineering_manager+ (`engineering.ranking.hr`) | `getEngineeringRankingPageData`, `getHrAuxiliaryData`, `buildHrEvidencePack` | Fork required |

## Layout and Navigation

**Layout** (`src/app/dashboard/engineering/layout.tsx`): wraps all pages, loads `getCurrentUserRole()` and `getDashboardPermissionRoleMap()`, renders `EngineeringTabs` with conditional tab visibility based on role.

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

| Module | Key Exports | Used By |
|--------|-------------|---------|
| `src/lib/data/engineering.ts` | `getEngineeringRankings`, `getEngineerProfile`, `getEngineerTimeSeries`, `getSquadPillarMetrics`, `getEngineerPerformanceRatings`, `getEngineerAiUsage`, `getEngineerCodeReview` | Engineers, Pillars, Squads, Profile |
| `src/lib/data/engineering-impact.ts` | `getImpactAnalysis` | Impact page |
| `src/lib/data/impact-model.ts` | Impact model types and constants | Impact model page |
| `src/lib/data/impact-model.server.ts` | `getImpactModelHydrated`, `buildTeamView`, `getAllManagers` | Impact model page |
| `src/lib/data/engineering-composite.ts` | `getEngineeringRankingPageData`, `getHrAuxiliaryData`, `buildHrEvidencePack` | Ranking, Methodology, HR Review |
| `src/lib/data/engineering-swarmia.ts` (or similar) | `getDoraScorecard`, `getDoraTrend`, `getPillarWeeklyTrend`, `getSquadLeaderboard` | Delivery Health |

## API Routes

| Route | Method | Role Gate | Purpose |
|-------|--------|-----------|---------|
| `/api/engineering-ranking/snapshot` | POST | CEO | Persist ranking snapshot |
| `/api/engineering-ranking/snapshot` | GET | CEO | Fetch snapshot by date |
| `/api/sync/code-review` | POST | CEO | Run code-review analysis |

## Components (A-side)

| Component | File | Used By |
|-----------|------|---------|
| `EngineeringTabs` | `src/components/dashboard/engineering-tabs.tsx` | Layout |
| `EngineeringTable` | `src/components/dashboard/engineering-table.tsx` | Engineers |
| `EngineerTopMetrics` | `src/components/dashboard/engineer-top-metrics.tsx` | Engineers, Pillars, Squads |
| `EngineeringSquadView` | `src/components/dashboard/engineering-squad-view.tsx` | Pillars, Squads |
| `EngineeringFilters` | `src/components/dashboard/engineering-filters.tsx` | Multiple |
| `ImpactReport` | `impact/_components/impact-report.tsx` | Impact |
| `ImpactModelReport` | `impact-model/_components/model-report.tsx` | Impact model |
| `CodeReviewReport` | `code-review/_components/code-review-report.tsx` | Code review |
| `MainScaffold` | `ranking/_components/main-scaffold.tsx` | Ranking |
| `MethodologyScaffold` | `ranking/_components/methodology-scaffold.tsx` | Methodology |
| `HrReviewSection` | `ranking/_components/hr-review-section.tsx` | HR Review |
| `CompositeTable` | `ranking/_components/composite-table.tsx` | Ranking |
| Shared helpers | `_shared.tsx` | Delivery Health, misc |

## Summary

**Total pages:** 12 (including root redirect and 3 ranking sub-pages)
**Total conditional tabs:** 4 (Impact, Impact model, Code review, Ranking)
**Total data loaders:** ~20 exported functions across 5-6 modules
**Total API routes:** 3

**Reusability breakdown:**
- Fully reusable (no changes for B-side): 5 pages (Delivery Health, Engineers, Pillars, Squads, root redirect)
- Reusable with role scoping: 2 pages (Impact, Engineer Profile)
- Fork required: 5 pages (Impact Model, Code Review, Ranking, Methodology, HR Review)

B-side target: collapse all 12 pages into 1 root surface with 2 persona renderings (Engineer view, Manager view). This represents a reduction from 12 pages + 8 tabs + period picker + multiple filters to 1 page + 2 views.
