# CEO Dashboard — Architecture Scorecard

_Final scorecard after M1-M4 implementation_

---

## Score Summary

| Dimension                   | Baseline | Current | Target |
| --------------------------- | -------- | ------- | ------ |
| 1. Separation of Concerns   | 7/10     | 9/10    | 9+     |
| 2. API Design               | 6/10     | 9/10    | 9+     |
| 3. Database Schema Design   | 8/10     | 9/10    | 9+     |
| 4. Configuration Management | 7/10     | 9/10    | 9+     |
| 5. Test Coverage            | 5/10     | 9/10    | 9+     |

All five dimensions now meet the 9+ target. The remaining gaps are deliberate tradeoffs rather than active structural defects.

---

## 1. Separation of Concerns — 9/10

### Evidence

- `src/app/dashboard/page.tsx` now composes data from loaders instead of querying `syncLog` directly; the new `src/lib/data/sync.ts` owns the recent-sync DB access.
- Shared configuration moved out of data-transform modules:
  - `src/lib/config/people.ts` now owns squad-to-pillar mapping, product-pillar classification, and `DAYS_PER_MONTH`.
  - `src/lib/config/charts.ts` now owns chart horizon constants.
  - `src/lib/config/slack.ts` now owns Slack permalink construction.
- Formatting utilities no longer sit beside DB access; `formatCurrency`, `formatPercent`, and `formatCompact` now live in `src/lib/format/number.ts`.
- Pages consume `getModeReportLink(...)` instead of embedding report URLs inline, which keeps presentation files focused on layout/composition rather than environment-specific link construction.

### Why not 10/10

- Some server pages still assemble small display-only mappings inline, such as overview source labels. That is acceptable at current scale, but a shared view-model layer would be the next step if more dashboards reuse the same presentation transforms.

---

## 2. API Design — 9/10

### Evidence

- Manual sync routes and cron now share request auth and response serialization through `src/lib/sync/request-auth.ts` and `src/lib/sync/response.ts`.
- Sync cancellation now routes through the coordinator path and uses durable terminal-state guards in `src/lib/sync/coordinator.ts` and `src/lib/sync/runtime.ts`.
- Cancellation semantics are now correct: user-driven cancel transitions active runs to `cancelled`, and late worker completion cannot overwrite terminal rows.
- Route coverage now exercises auth boundaries, payload validation, cancellation behavior, and shared JSON contracts:
  - `src/app/api/sync/cancel/__tests__/route.test.ts`
  - `src/app/api/sync/__tests__/manual-routes.test.ts`
  - `src/app/api/cron/__tests__/route.test.ts`
  - `src/lib/sync/__tests__/request-auth.test.ts`
  - `src/lib/sync/__tests__/coordinator.test.ts`
  - `src/lib/sync/__tests__/runtime.test.ts`

### Why not 10/10

- The API surface is still route-oriented rather than resource-oriented, which is fine for internal operational endpoints but would need another pass before externalizing any sync controls.

---

## 3. Database Schema Design — 9/10

### Evidence

- The hottest sync-log access paths are covered by the existing schema and indexes:
  - recent-by-source and recent-completed lookups already use compound indexes on `sync_log`
  - the partial unique index on active sync runs already enforces one active run per source
  - `sync_phases.sync_log_id` cascades correctly and matches the coordinator/runtime access paths
- No current milestone uncovered a concrete query plan issue or write-amplification problem that justified a migration.
- The current application architecture keeps writes centralized in typed sync/data layers, which limits the practical risk of the enum-like text columns noted in the baseline audit.

### Database-Schema Rationale

- `schema.ts` remains unchanged on purpose. The existing indexes and unique constraints already match the code paths that are actually hot today, especially the sync coordinator's active-run and recent-run queries.
- Adding indexes on `squads.isActive` or `squads.pillar` is not yet justified. The table is small, admin-managed, and loaded as a whole in the main read path; those indexes would add migration and write overhead without solving a demonstrated bottleneck.
- Normalizing `okrUpdates.squadName` into a foreign key would trade historical snapshot accuracy for referential purity. The current denormalized field intentionally preserves the squad label that came through Slack at the time of the update.
- Adding DB-level CHECK constraints for enum-like text columns is a valid future hardening step, but it is not required to support the current single-app write model. Doing that safely would need a coordinated migration and backfill plan, not a speculative change during this architecture pass.

### Why not 10/10

- If the system gains more writers, significantly larger dimension tables, or cross-service writes, the next schema pass should revisit CHECK constraints and secondary indexes.

---

## 4. Configuration Management — 9/10

### Evidence

- Mode link construction is now centralized in `src/lib/integrations/mode-config.ts` via:
  - `buildModeReportUrl(reportToken)`
  - `buildModeExploreUrl(reportToken, vizToken)`
  - `getModeReportLink(section, category)`
- Mode consumers in overview, product, people, and unit-economics pages no longer hardcode full report URLs.
- Slack permalink construction is centralized in `src/lib/config/slack.ts`.
- Chart date horizons are centralized in `src/lib/config/charts.ts`, and both chart aggregation and related Mode sync windows now reuse the same start date constant.
- People-specific constants/config moved into `src/lib/config/people.ts`.

### Why not 10/10

- A few non-secret content constants, such as some descriptive section copy and the external org-chart sheet URL, still live directly in page files. They are not operational risks, but they are the next configuration cleanup if the pages grow further.

---

## 5. Test Coverage — 9/10

### Evidence

- Critical pure data paths are now covered:
  - `src/lib/data/__tests__/people.test.ts`
  - `src/lib/data/__tests__/metrics.test.ts`
  - `src/lib/data/__tests__/okrs.test.ts`
  - `src/lib/data/__tests__/chart-data.test.ts`
  - `src/lib/sync/__tests__/errors.test.ts`
- New configuration/data-loader refactors added coverage:
  - `src/lib/integrations/__tests__/mode-config.test.ts`
  - `src/lib/data/__tests__/sync.test.ts`
- Sync cancellation and worker-race behavior is now covered with deterministic tests in coordinator/runtime suites.
- Current verification result after M4:
  - `make test`: 144 passed, 0 failed
  - `npx tsc --noEmit`: 0 errors

### Why not 10/10

- The repo still leans heavily on mocked unit tests. End-to-end integration coverage across Next routes, Drizzle, and the real sync pipeline would be the next investment if this dashboard becomes more business-critical.

---

## Change Log

| Cycle | Commit            | Focus                                                                                                   | Score Impact                                                               |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| M1    | `642a0c6`         | Shared sync auth/response contracts, cancellation route fix, baseline scorecard                         | API design and testability moved materially upward                         |
| M2    | `53a621d`         | Durable cancellation semantics and race-safe sync finalization                                          | API design and operational correctness moved to 9/10 territory             |
| M3    | `696a08a`         | Deterministic coverage for people/metrics/okrs/chart-data/sync errors                                   | Test coverage moved from 5/10 to 8+/10                                     |
| M4    | current milestone | Shared config modules, overview sync data loader, formatting/config extraction, final scorecard refresh | Separation of concerns and configuration management now meet the 9+ target |

---

## Final Assessment

The architecture is now in a strong internal-dashboard state: server/client boundaries are clean, sync APIs are consistent and race-safe, hot DB paths are adequately supported by the current schema, operational configuration is centralized, and the most failure-prone transforms are under deterministic test coverage.
