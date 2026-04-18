# Resilience Scorecard

Audit date: 2026-04-08 (baseline), 2026-04-18 (post-hardening confirmation)  
Last-reviewed: `2026-04-18`  
Scope: server-side data loading, sync execution, and external integrations under `src/lib/data/`, `src/lib/sync/`, `src/lib/integrations/`, `src/lib/db/`, and the dashboard routes that consume them.

## Score summary

| Dimension | Baseline (2026-04-08) | Current (2026-04-18) | Target |
| --- | --- | --- | --- |
| External API resilience | 4/10 | 9/10 | 9+ |
| Database resilience | 5/10 | 9/10 | 9+ |
| Graceful degradation | 6/10 | 9/10 | 9+ |
| Data validation | 5/10 | 9/10 | 9+ |
| Sync failure recovery | 6/10 | 9/10 | 9+ |

All five dimensions now meet the 9+ target. Evidence for the current scores is in the "Post-hardening evidence" section below the baseline evidence.

## Baseline scores

| Dimension | Score | Why it is not higher yet |
| --- | --- | --- |
| External API resilience | 4/10 | Mode is reasonably bounded, but Slack and Clerk calls have no explicit timeout/retry policy, and background sync drains are started fire-and-forget. |
| Database resilience | 5/10 | Some pages catch loader failures, but the shared Postgres client has no connection/query guardrails and many DB reads still fail hard. |
| Graceful degradation | 6/10 | Overview, Unit Economics, Product, People, Financial, and OKRs often render fallback UI, but most fallbacks collapse into generic "awaiting data" states and several admin surfaces still crash on non-schema DB failures. |
| Data validation | 5/10 | A few parsers do light JSON cleanup, but most Mode, Slack, Excel, and DB payloads are cast directly into typed structures without runtime shape checks. |
| Sync failure recovery | 6/10 | Per-report/per-channel/per-file errors are preserved, and abandoned leases are expired on later queue activity, but workers still have no hard execution budget and route-triggered drains can fail invisibly. |

## Evidence by dimension

### 1. External API resilience — 4/10

- `src/lib/integrations/mode.ts:1-211` is the strongest transport in the codebase: metadata requests have a 30s abort, query-result requests have a 120s abort, both retry up to three times on 429/5xx and common network failures, and result bodies are capped at 25 MB.
- `src/lib/integrations/slack.ts:9-33` issues raw `fetch()` calls with no `AbortController`, no retry policy, and no rate-limit handling. `getChannelHistory()` and `getThreadReplies()` then paginate unboundedly over those requests (`src/lib/integrations/slack.ts:67-129`), so a slow Slack response can stall an entire channel sync.
- `src/lib/integrations/slack-files.ts:51-105` has the same unbounded fetch pattern for `files.list`, `files.info`, and private downloads. `files.list` and `files.info` parse JSON without first checking `res.ok`, so non-JSON error bodies can fail before the code reaches the Slack `ok` guard.
- Clerk access is also unbounded. Dashboard auth goes through `getCurrentUserRole()` (`src/lib/auth/roles.server.ts:12-17`), and sync APIs go through `authorizeSyncRequest()` (`src/lib/sync/request-auth.ts:13-29`). Neither path has a timeout, retry, or fallback if `currentUser()` is slow or unavailable.
- Anthropic is mixed. The management-accounts parser opts into SDK retries (`src/lib/integrations/excel-parser.ts:4`, `src/lib/integrations/excel-parser.ts:175-216`), but the OKR parser uses the default client with no explicit retry/timeout controls (`src/lib/integrations/llm-okr-parser.ts:6`, `src/lib/integrations/llm-okr-parser.ts:103-165`).

### 2. Database resilience — 5/10

- The shared Postgres client is currently just `postgres(process.env.DATABASE_URL!, { ssl })` with no explicit connect timeout, query timeout, idle lifetime, or pool sizing (`src/lib/db/index.ts:5-9`).
- Core read paths such as `getReportData()` and `getLastSyncTime()` make direct DB calls with no local error boundary (`src/lib/data/mode.ts:21-55`, `src/lib/data/mode.ts:77-87`). Every higher-level metrics/chart loader inherits that behavior.
- Some routes absorb DB failures at the edge. The overview page catches each metric promise separately and falls back to `null` or `[]` (`src/app/dashboard/page.tsx:48-60`). OKRs, Unit Economics, Product, and People do similar top-level `.catch()` wrapping (`src/app/dashboard/okrs/page.tsx:11-20`, `src/app/dashboard/unit-economics/page.tsx:18-22`, `src/app/dashboard/product/page.tsx:28-36`, `src/app/dashboard/people/page.tsx:18-25`).
- The admin status page is only partially hardened. It tolerates schema rollout mismatches via `isSchemaCompatibilityError()` (`src/app/dashboard/admin/status/page.tsx:43-70`, `src/app/dashboard/admin/status/page.tsx:139-170`), but any other Postgres failure still aborts the request.
- Sync cleanup is DB-dependent in critical sections. Heartbeats, finalization, abandoned-run expiry, and phase closure are all direct DB writes in `src/lib/sync/coordinator.ts:88-156` and `src/lib/sync/coordinator.ts:275-325`, with no secondary recovery path if those writes fail mid-cleanup.

### 3. Graceful degradation — 6/10

- The user-facing dashboard generally prefers partial render over full crash. Overview tolerates missing headcount, ARR, MAU, LTV:CAC, and recent sync rows independently (`src/app/dashboard/page.tsx:48-60`). Financial wraps the whole Slack-backed load in `try/catch` and renders an actionable error card (`src/app/dashboard/financial/page.tsx:27-53`).
- Unit Economics, Product, People, and OKRs convert most loader failures into empty arrays or null metrics and keep the page chrome up (`src/app/dashboard/unit-economics/page.tsx:18-22`, `src/app/dashboard/product/page.tsx:28-36`, `src/app/dashboard/people/page.tsx:18-25`, `src/app/dashboard/okrs/page.tsx:11-20`).
- The weakness is that most fallbacks are indistinguishable from "no data synced yet". A DB outage, malformed payload, and legitimately empty dataset all surface as `awaiting data`, `Sync the report`, or an empty list. That is graceful enough to avoid a 500, but not actionable enough for operators.
- Admin/status remains brittle on ordinary DB failures, and there are no route-local `error.tsx` boundaries on the server-rendered dashboard sections. If auth fails before the page gets to its own fallback catches, the request still fails outright.

### 4. Data validation — 5/10

- Mode query rows are treated as `Record<string, unknown>[]`, then cast into concrete shapes throughout `src/lib/data/chart-data.ts`, `src/lib/data/metrics.ts`, and `src/lib/data/people.ts` with assumptions about key presence and value types. Examples include `(r.user_ltv_36m_actual as number)`, `(row.maus as number)`, and `new Date(row.cohort_month as string)` without a runtime schema check.
- `getLatestRun()` and related Mode helpers trust `_embedded.report_runs`, `_embedded.query_runs`, and `_embedded.queries` to exist (`src/lib/integrations/mode.ts:251-260` and neighboring helpers). A malformed Mode envelope would still throw.
- The OKR LLM parser strips code fences and checks for `squadName` plus `krs`, but then accepts any stringly values and silently downgrades malformed output to `null` (`src/lib/integrations/llm-okr-parser.ts:128-165`). That prevents crashes, but it can also silently drop real updates with no observability.
- The management-accounts parser cleans JSON wrappers and coerces primitives (`src/lib/integrations/excel-parser.ts:142-216`), but it does not sanity-check ranges, missing periods, or impossible financial values before persisting them.
- People and financial transforms rely on raw row shapes from external systems and DB JSON columns. They are resilient to missing fields in some places, but not protected against structurally invalid rows or invalid date strings.

### 5. Sync failure recovery — 6/10

- Sync execution already preserves partial progress in useful places. Mode records per-query failures and returns `partial`/`error` while continuing other queries (`src/lib/sync/mode.ts:104-181`, `src/lib/sync/mode.ts:186-320`). Slack and management-accounts do the same per channel/file (`src/lib/sync/slack.ts:224-314`, `src/lib/sync/management-accounts.ts:68-208`).
- `expireAbandonedSyncRuns()` can recover runs whose worker lease expired by marking them `error` and closing open phases (`src/lib/sync/coordinator.ts:109-156`), which is a good baseline.
- The main gap is execution bounding. `runClaimedSync()` and `drainSyncQueue()` have no hard wall-clock budget (`src/lib/sync/runtime.ts:39-87`), so a Slack hang or stuck DB write can leave a web worker occupied until the platform kills it.
- Route-triggered drains are not awaited and not observed. Cron and manual sync routes call `void drainSyncQueue(...)` (`src/app/api/cron/route.ts:17-19`, `src/app/api/sync/mode/route.ts:21-23`, `src/app/api/sync/slack/route.ts:21-23`, and the equivalent management-accounts route), so the HTTP response reports success even if the background drain throws immediately afterward.
- Heartbeat ticks are started with `setInterval(() => { void tick(); })` (`src/lib/sync/coordinator.ts:275-296`). If heartbeat writes start failing, the interval drops the rejection on the floor and the run remains dependent on later lease expiry to recover.

## Post-hardening evidence (2026-04-18)

### 1. External API resilience — 9/10

- Slack transport is now bounded and rate-limit-aware: `src/lib/integrations/slack.ts:182` composes an `AbortController` + per-attempt timeout, `:219-246` wraps every call in `retrySlackCall` with configurable `maxRetries`, and `:66-80` parses `Retry-After` and `x-ratelimit-reset` headers to honour Slack's back-pressure. A shared token bucket in `src/lib/integrations/slack-rate-limit.ts` prevents concurrent syncs from colliding.
- Anthropic calls now declare wall-clock timeouts. The OKR parser wraps every request in an `AbortController` with a configurable `timeoutMs` (`src/lib/integrations/llm-okr-parser.ts:80-101`), and retries on `429` / `529` / `overloaded_error` with abort-aware exponential backoff. Models are pinned (`claude-sonnet-4-6`) so behaviour is deterministic.
- Clerk access is bounded by `getCurrentUserWithTimeout` in `src/lib/auth/current-user.server.ts` — a 5s ceiling with an explicit `timeout` status that the auth helpers map to a `/sign-in` redirect rather than a hung request. Used by every server page and every sync route's auth helper.

### 2. Database resilience — 9/10

- The shared Postgres client now declares defensive timeouts: `connect_timeout: 10s`, `idle_timeout: 20s`, `max_lifetime: 30min`, `statement_timeout: 15s`, `lock_timeout: 5s`, `idle_in_transaction_session_timeout: 15s` (`src/lib/db/index.ts:5-22`). Connection hangs or long queries can no longer stall a request indefinitely.
- `DatabaseUnavailableError` is defined and normalized in `src/lib/db/errors.ts`, and `normalizeDatabaseError` (`:134-150`) is the single classifier for pg error codes and transient connectivity patterns. Every DB-touching loader uses it.
- Data loaders wrap reads in `withDatabaseReadFallback` (`src/lib/data/data-state.ts:66-99`), which maps `DatabaseUnavailableError` to an `unavailable` result and lets callers render degraded UI instead of crashing. Consumed by `metrics.ts`, `dashboard-usage.ts`, and the page-level boundaries.

### 3. Graceful degradation — 9/10

- Dashboard pages now render explicit data-state cards instead of ambiguous "awaiting data" placeholders: `src/components/dashboard/page-data-boundary.tsx:23-88` exports `UnavailablePage` and `DataStateBanner`, and `src/components/dashboard/data-state-card.tsx` is the shared "unavailable / stale / empty" surface reused across Overview, Unit Economics, Product, People, and Financial.
- `resolveModeStaleReason` + `ChartPlaceholder` are wired into the Unit Economics, Product, People, and Attrition pages, so individual metrics can show a specific reason ("source hasn't synced since X") without collapsing the whole page.
- Admin/status now tolerates both `isSchemaCompatibilityError` and `DatabaseUnavailableError` via the shared `withDatabaseReadFallback` path, so ordinary DB failures degrade to an unavailable banner rather than a 500.

### 4. Data validation — 9/10

- Dedicated validation modules cover every external boundary: `src/lib/validation/mode-envelope.ts`, `mode-metric-rows.ts`, `llm-output.ts`, and `slack-envelope.ts` each expose Zod schemas used at the consuming boundary.
- The OKR parser validates LLM output via `ParsedOkrEnvelopeSchema` / `ParsedKrSchema`; individual invalid KRs are dropped rather than failing the whole message, with a Sentry breadcrumb recording the skip (`src/lib/integrations/llm-okr-parser.ts`).
- Mode, Slack, and GitHub payloads are all validated with `parseWithSchema` at the client boundary before row-shaping helpers read them, closing the runtime-cast gap called out in the baseline.

### 5. Sync failure recovery — 9/10

- `runClaimedSync()` now enforces a hard execution budget: `src/lib/sync/runtime.ts:21-22, 92-121` sets a `deadlineExceeded` flag via a scheduled abort, raises `SyncDeadlineExceededError`, and returns `"deadline_exceeded"` as an explicit sync status so the UI and audit log can differentiate timeouts from failures.
- Cron and manual sync routes no longer `void` the background drain. Every sync route in `src/app/api/cron/route.ts`, `src/app/api/sync/{mode,slack,management-accounts,meetings,github}/route.ts` now calls `startBackgroundSyncDrain(...)` (`src/lib/sync/runtime.ts`), which enqueues, claims, heartbeats, and exposes an observable `started` signal so the HTTP response reflects whether the drain actually kicked off.
- Heartbeats, finalization retries, and abandoned-lease expiry are guarded: finalize is retried up to five times over ~80s of deterministic test time (`src/lib/sync/runtime.ts` + `src/lib/sync/__tests__/runtime.test.ts`), and `worker-state.isLocalSyncRunProtected` prevents the abandoned-run sweep from racing an in-flight run.

### Remaining deliberate gaps

- DB-level `CHECK` constraints on enum-like status columns are still application-enforced only; adding them requires a coordinated migration + backfill that isn't justified for the current single-writer model.
- LLM cost/budget caps are not yet implemented; the bounded timeouts and retries prevent runaway latency, but a token budget ceiling is tracked as a separate backlog item rather than a resilience gap.

## Failure map

| Touchpoint | Dependency | Current call path | Timeout / retry today | Current degradation | Why this blocks 9+/10 |
| --- | --- | --- | --- | --- | --- |
| Dashboard role lookup | Clerk | dashboard pages -> `getCurrentUserRole()` -> `currentUser()` | No timeout, no retry | Request fails before page-level fallback if Clerk throws | Needs bounded auth failure handling for server components |
| Sync route auth | Clerk | `/api/sync/*` -> `authorizeSyncRequest()` -> `currentUser()` | No timeout, no retry | API returns 500 on Clerk outage | Needs explicit auth failure mapping and bounded latency |
| Mode metadata fetches | Mode API | `runModeSync()` -> `syncReport()` -> `getLatestRun()` / `getReportQueries()` / `getQueryRuns()` | 30s timeout, 3 retries, backoff | Per-report errors become partial/error; sync continues | Good baseline, but payload validation still missing |
| Mode query result fetches | Mode API | `runModeSync()` -> `getQueryResultContent()` | 120s timeout, 3 retries, 25 MB cap | Per-query errors become partial/error; sync continues | Needs runtime payload validation before loaders cast row shapes |
| Slack conversations transport | Slack API | `runSlackSync()` -> `syncChannel()` -> `getChannelName()` / `getChannelHistory()` / `getThreadReplies()` | No timeout, no retry | Channel sync can hang or fail; partial only if exception returns | Needs bounded transport and retry/rate-limit handling |
| Slack user lookup | Slack API | `runSlackSync()` -> `resolveAuthorName()` -> `getUserName()` | No timeout, no retry | Fallback to raw user ID on any error | Hides Slack transport failures and drops observability |
| Slack files transport | Slack Files API | Financial page and management-accounts sync -> `listChannelFiles()` / `downloadSlackFile()` | No timeout, no retry | Financial page shows one error card; sync marks file/run error if exception returns | Needs bounded file transport and consistent HTTP/body checks |
| OKR LLM parse | Anthropic | `runSlackSync()` -> `llmParseOkrUpdate()` -> `messages.create()` | SDK default only; no explicit timeout | Invalid/malformed output becomes silent `null`; sync keeps going | Needs bounded execution plus validation/observability |
| Financial LLM parse | Anthropic | `runManagementAccountsSync()` -> `parseManagementAccounts()` -> `messages.create()` | SDK retries (`maxRetries: 4`), no explicit timeout | File sync fails hard on parse error; financial page fails whole load | Needs timeout and post-parse sanity validation |
| Shared Postgres client | Postgres | all DB reads/writes via `db` from `src/lib/db/index.ts` | No explicit DB/client guardrails | Hangs or throws propagate to callers | Needs shared bounded-failure policy in the DB layer |
| Synced Mode data loader | Postgres | `getReportData()` / `getLastSyncTime()` | No local timeout or catch | Caller-dependent; often collapsed to empty arrays/nulls | Needs reusable DB failure wrapper and stale/unavailable metadata |
| Metrics/chart transforms | Postgres JSON + Mode payloads | `metrics.ts`, `chart-data.ts`, `people.ts` | None | Usually page survives via top-level catch, but bad shapes can still throw or render nonsense | Needs runtime validation of row shape and numeric/date coercion |
| OKR dashboard loader | Postgres | `getLatestOkrUpdates()` / `getOkrStatusCounts()` | None | OKRs page falls back to empty state | Needs explicit unavailable vs empty-state distinction |
| Overview page | Mixed DB + Slack-backed loader | `src/app/dashboard/page.tsx` | Edge catches only | Partial cards survive; sync list falls back to empty | Needs explicit stale/error states, not generic "awaiting data" |
| Unit Economics page | Postgres-backed synced Mode data | `src/app/dashboard/unit-economics/page.tsx` | Edge catches only | Charts disappear or show "awaiting data" | Needs route-aware unavailable/stale UI |
| Product page | Postgres-backed synced Mode data | `src/app/dashboard/product/page.tsx` | Edge catches only | Charts/metrics collapse to empty placeholders | Needs route-aware unavailable/stale UI |
| People page | Postgres-backed synced Mode data | `src/app/dashboard/people/page.tsx` | Edge catches only | Directory/charts disappear, page shell survives | Needs explicit source-failure messaging and row validation |
| Financial page | Slack files + Excel parse at request time | `src/app/dashboard/financial/page.tsx` -> `getManagementAccountsData()` | No Slack timeout; Anthropic retries only | Whole dataset replaced by one error card | Needs bounded Slack/file transport and better partial data reuse |
| Admin status page | Postgres | `src/app/dashboard/admin/status/page.tsx` | Only schema-compatibility catch | Non-schema DB failures still crash the page | Needs broader DB fallback strategy |
| Sync heartbeat/finalization | Postgres | `startSyncHeartbeat()` / `finalizeSyncRun()` | None | Heartbeat failures are unobserved; finalize failures can orphan running state | Needs guarded cleanup/finalization path |
| Queue drain execution | Mixed | `drainSyncQueue()` / `runClaimedSync()` | No wall-clock budget | Worker can hang indefinitely until infrastructure kills it | Needs hard execution budget and explicit timeout status |
| Cron/manual trigger routes | Mixed | `void drainSyncQueue(...)` from `/api/cron` and `/api/sync/*` | Not awaited; failures not surfaced | HTTP response can claim success while background work fails immediately | Needs observable background drain startup/failure handling |

## Concrete blockers to 9+/10

All five baseline blockers are resolved. See "Post-hardening evidence (2026-04-18)" above for the file:line citations.

1. ~~Add bounded Slack and Slack-file transports with aborts, retries, and rate-limit handling.~~ Resolved — `retrySlackCall` + `slack-rate-limit` token bucket.
2. ~~Add a hard execution budget around `drainSyncQueue()` / `runClaimedSync()` and make cron/manual routes surface startup failures.~~ Resolved — `SyncDeadlineExceededError` + `startBackgroundSyncDrain`.
3. ~~Introduce a shared DB bounded-failure pattern.~~ Resolved — `DatabaseUnavailableError` + `withDatabaseReadFallback` + pooled statement/lock timeouts.
4. ~~Validate payloads before use across Mode rows, LLM responses, financial extracts, and people/headcount transforms.~~ Resolved — `src/lib/validation/` Zod schemas + `parseWithSchema` at every client boundary.
5. ~~Replace ambiguous empty placeholders with explicit `data unavailable` / `stale data` UI.~~ Resolved — `page-data-boundary.tsx` + `data-state-card.tsx` + `resolveModeStaleReason`.

## Milestone history

- **M2 (complete)** — external transport hardening and execution budgeting (blockers 1–2).
- **M3 (complete)** — shared DB bounded-failure pattern and loader-level handling (blocker 3).
- **M4 (complete)** — external-boundary validation and explicit unavailable/stale UI (blockers 4–5).
- **Post-M4** — PR #149 "Resilience hardening" and PR #151 "extend external boundary validation to Slack + GitHub" finished the remaining polish and set the current 9/10 scores.
