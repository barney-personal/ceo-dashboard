# API And Dashboard Route Reference

This document is generated from the live App Router handlers and pages under `src/app/` plus the auth helpers in `src/proxy.ts`, `src/lib/auth/*`, and `src/lib/sync/request-auth.ts`.

## Access Model

### Proxy-level protection for pages

All non-public, non-API routes pass through `src/proxy.ts`.

- Public routes: `/`, `/sign-in`, `/sign-up`, `/access-denied`
- API routes: `/api/*` bypass proxy auth and enforce auth inside the route handler
- Protected pages require:
  - a valid Clerk session via `auth.protect()`
  - a primary email ending in `@meetcleo.com`

### Role model

- `everyone`: default authenticated user role
- `leadership`
- `ceo`

Role checks use Clerk `publicMetadata.role` and `hasAccess()` from `src/lib/auth/roles.ts`.

### Sync API auth modes

Sync trigger routes under `/api/sync/*` use `authorizeSyncRequest()`:

- Cron caller: `Authorization: Bearer $CRON_SECRET`
- Manual caller: authenticated Clerk user with `ceo` role
- `401 Unauthorized`: no valid cron secret and no authenticated user
- `403 Forbidden`: authenticated user without `ceo`

## API Routes

### Shared sync response shape

`/api/cron`, `/api/sync/mode`, `/api/sync/slack`, and `/api/sync/management-accounts` all serialize `EnqueueSyncResult` to:

```json
{
  "outcome": "queued | forced | skipped | already-running",
  "runId": 123,
  "reason": "within_interval | running | active_run_exists | ... | null",
  "nextEligibleAt": "2026-04-08T10:30:00.000Z"
}
```

`runId` and `nextEligibleAt` may be `null`.

---

### `GET /api/cron`

- Purpose: enqueue all scheduled sync sources in one request
- Auth required: yes, cron secret only
- Auth enforcement: route handler via `isCronRequest()`
- Data sources touched:
  - writes `sync_log` through `enqueueSyncRun()`
  - starts worker drain through `startBackgroundSyncDrain()`
- Request:
  - headers:
    - `Authorization: Bearer $CRON_SECRET`
  - body: none
  - query params: none
- Success: `200 OK`

Success response shape:

```json
{
  "status": "syncs enqueued",
  "results": {
    "mode": {
      "outcome": "queued",
      "runId": 1,
      "reason": null,
      "nextEligibleAt": "2026-04-08T08:00:00.000Z"
    },
    "slack": {
      "outcome": "skipped",
      "runId": 2,
      "reason": "within_interval",
      "nextEligibleAt": "2026-04-08T10:00:00.000Z"
    },
    "managementAccounts": {
      "outcome": "forced",
      "runId": 3,
      "reason": null,
      "nextEligibleAt": "2026-04-08T09:30:00.000Z"
    }
  }
}
```

Common errors:

- `401 Unauthorized`

```json
{ "error": "Unauthorized" }
```

- `500 Internal Server Error`
  - unhandled coordinator/runtime/database errors bubble to Next.js

Example:

```bash
curl -X GET \
  "$BASE_URL/api/cron" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

### `POST /api/sync/mode`

- Purpose: enqueue a Mode sync on demand
- Auth required: yes
- Allowed callers:
  - cron secret
  - authenticated `ceo`
- Auth enforcement: route handler via `authorizeSyncRequest()`
- Data sources touched:
  - writes `sync_log`
  - drains the `mode` worker queue
- Request:
  - query params:
    - `force=1` optional, bypasses interval checks
  - body: none
- Success: `200 OK`

Success response shape:

```json
{
  "outcome": "queued | forced | skipped | already-running",
  "runId": 17,
  "reason": null,
  "nextEligibleAt": "2026-04-08T09:00:00.000Z"
}
```

Common errors:

- `401 Unauthorized`

```json
{ "error": "Unauthorized" }
```

- `403 Forbidden`

```json
{ "error": "Forbidden" }
```

- `500 Internal Server Error`
  - unhandled auth, coordinator, or worker startup failures

Examples:

```bash
curl -X POST \
  "$BASE_URL/api/sync/mode" \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl -X POST \
  "$BASE_URL/api/sync/mode?force=1" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE"
```

---

### `POST /api/sync/slack`

- Purpose: enqueue a Slack OKR sync on demand
- Auth required: yes
- Allowed callers:
  - cron secret
  - authenticated `ceo`
- Auth enforcement: route handler via `authorizeSyncRequest()`
- Data sources touched:
  - writes `sync_log`
  - drains the `slack` worker queue
- Request:
  - query params:
    - `force=1` optional, bypasses interval checks
  - body: none
- Success: `200 OK`

Success response shape:

```json
{
  "outcome": "queued | forced | skipped | already-running",
  "runId": 17,
  "reason": null,
  "nextEligibleAt": "2026-04-08T09:00:00.000Z"
}
```

Common errors:

- `401 Unauthorized`

```json
{ "error": "Unauthorized" }
```

- `403 Forbidden`

```json
{ "error": "Forbidden" }
```

- `500 Internal Server Error`
  - unhandled auth, coordinator, or worker startup failures

Examples:

```bash
curl -X POST \
  "$BASE_URL/api/sync/slack" \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl -X POST \
  "$BASE_URL/api/sync/slack?force=1" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE"
```

---

### `POST /api/sync/management-accounts`

- Purpose: enqueue a management accounts Slack file sync on demand
- Auth required: yes
- Allowed callers:
  - cron secret
  - authenticated `ceo`
- Auth enforcement: route handler via `authorizeSyncRequest()`
- Data sources touched:
  - writes `sync_log`
  - drains the `management-accounts` worker queue
- Request:
  - query params:
    - `force=1` optional, bypasses interval checks
  - body: none
- Success: `200 OK`

Success response shape:

```json
{
  "outcome": "queued | forced | skipped | already-running",
  "runId": 23,
  "reason": null,
  "nextEligibleAt": "2026-04-08T10:30:00.000Z"
}
```

Common errors:

- `401 Unauthorized`

```json
{ "error": "Unauthorized" }
```

- `403 Forbidden`

```json
{ "error": "Forbidden" }
```

- `500 Internal Server Error`
  - unhandled auth, coordinator, or worker startup failures

Examples:

```bash
curl -X POST \
  "$BASE_URL/api/sync/management-accounts" \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl -X POST \
  "$BASE_URL/api/sync/management-accounts?force=1" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE"
```

---

### `POST /api/sync/cancel`

- Purpose: cancel a queued or running sync run
- Auth required: yes, authenticated `ceo`
- Auth enforcement: route handler via `requireRole("ceo")`
- Data sources touched:
  - updates `sync_log` through `cancelSyncRun()`
  - may also close `sync_phases`
- Request:
  - headers:
    - `Content-Type: application/json`
  - body:

```json
{
  "syncLogId": 42
}
```

`syncLogId` may be either a positive integer or a numeric string; anything else is rejected.

- Success: `200 OK`

Success response shape:

```json
{
  "cancelled": true,
  "status": "cancelled"
}
```

Common errors:

- `400 Bad Request`

```json
{ "error": "syncLogId must be a positive integer" }
```

- `401 Unauthorized`

```json
{ "error": "Unauthorized" }
```

- `403 Forbidden`

```json
{ "error": "Forbidden" }
```

- `404 Not Found`

```json
{ "error": "not_found | not_cancellable" }
```

- `500 Internal Server Error`
  - unhandled JSON parse, coordinator, or database errors

Example:

```bash
curl -X POST \
  "$BASE_URL/api/sync/cancel" \
  -H "Content-Type: application/json" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE" \
  -d '{"syncLogId":42}'
```

---

### `GET /api/squads`

- Purpose: list all squads for the admin UI
- Auth required: yes, authenticated `ceo`
- Auth enforcement: route handler via `requireRole("ceo")`
- Data sources touched:
  - reads `squads`
- Request:
  - body: none
  - query params: none
- Success: `200 OK`

Success response shape:

```json
[
  {
    "id": 1,
    "name": "Growth",
    "pillar": "Growth",
    "channelId": "C0123456789",
    "pmName": "Jane Doe",
    "pmSlackId": null,
    "isActive": true,
    "createdAt": "2026-04-08T09:00:00.000Z",
    "updatedAt": "2026-04-08T09:00:00.000Z"
  }
]
```

Records are ordered by `pillar`, then `name`.

Common errors:

- `401 Unauthorized`
- `403 Forbidden`
- `500 Internal Server Error`

---

### `POST /api/squads`

- Purpose: create a squad
- Auth required: yes, authenticated `ceo`
- Auth enforcement: route handler via `requireRole("ceo")`
- Data sources touched:
  - inserts into `squads`
- Request:
  - headers:
    - `Content-Type: application/json`
  - body:

```json
{
  "name": "Growth",
  "pillar": "Growth",
  "pmName": "Jane Doe",
  "channelId": "C0123456789"
}
```

Request notes:

- `name` required
- `pillar` required
- `pmName` optional, stored as `null` when omitted
- `channelId` optional, stored as `null` when omitted

- Success: `201 Created`

Success response shape: created squad row, matching the `GET /api/squads` record shape.

Common errors:

- `400 Bad Request`

```json
{ "error": "name and pillar are required" }
```

- `401 Unauthorized`
- `403 Forbidden`
- `500 Internal Server Error`
  - duplicate `name`, invalid JSON, or other database failures are unhandled and surface as framework 500s

---

### `PUT /api/squads`

- Purpose: update a squad
- Auth required: yes, authenticated `ceo`
- Auth enforcement: route handler via `requireRole("ceo")`
- Data sources touched:
  - updates `squads`
- Request:
  - headers:
    - `Content-Type: application/json`
  - body:

```json
{
  "id": 1,
  "name": "Growth",
  "pillar": "Growth",
  "pmName": "Jane Doe",
  "channelId": "C0123456789",
  "isActive": true
}
```

Request notes:

- `id` required
- all other fields are optional partial updates
- `updatedAt` is always set server-side

- Success: `200 OK`

Success response shape: updated squad row, matching the `GET /api/squads` record shape.

Common errors:

- `400 Bad Request`

```json
{ "error": "id is required" }
```

- `401 Unauthorized`
- `403 Forbidden`

- `404 Not Found`

```json
{ "error": "Squad not found" }
```

- `500 Internal Server Error`
  - invalid JSON, unique constraint, or other database failures are unhandled and surface as framework 500s

---

### `GET /api/sentry-example-api`

- Purpose: intentionally throw an error to verify Sentry backend capture
- Auth required: no route-level auth
- Auth enforcement: none in handler; API routes bypass proxy auth
- Data sources touched: none
- Request:
  - body: none
  - query params: none
- Success: none, this route is intentionally faulty

Behavior:

- logs `"Sentry example API called"` to Sentry logger
- throws `SentryExampleAPIError`

Response behavior:

- `500 Internal Server Error` generated by Next.js error handling
- response format is not explicitly serialized by the route

## Dashboard Routes

### Dashboard enforcement summary

- `/dashboard/*` routes are protected by `src/proxy.ts`
  - authenticated Clerk session required
  - primary email must end with `@meetcleo.com`
- `src/app/dashboard/layout.tsx`
  - shared shell only
  - no role redirect
- `src/app/dashboard/people/layout.tsx`
  - leadership gate inherited by the whole People subtree
  - unauthorized users are redirected to `/dashboard`

### Route matrix

| Path | Minimum role | Enforcement | Data sources |
| --- | --- | --- | --- |
| `/dashboard` | `everyone` | Proxy only. No page-level redirect. Individual cards and links are hidden with `PermissionGate`. | Clerk role, `sync_log`, `financial_periods`, Mode-backed loaders in `chart-data.ts`, people metrics, Mode config links |
| `/dashboard/unit-economics` | `leadership` | Page-level redirect to `/dashboard` in `src/app/dashboard/unit-economics/page.tsx` | Mode-backed report data from Postgres via `chart-data.ts`; Mode embed metadata from `mode-config.ts` |
| `/dashboard/financial` | `ceo` | Page-level redirect to `/dashboard` in `src/app/dashboard/financial/page.tsx` | `financial_periods` and Slack-file-derived management accounts data via `management-accounts.ts`; Mode embeds for seasonality |
| `/dashboard/product` | `leadership` | Page-level redirect to `/dashboard` in `src/app/dashboard/product/page.tsx` | Mode-backed report data from Postgres via `chart-data.ts`; Mode config links |
| `/dashboard/okrs` | `everyone` | Proxy only. No page-level redirect. | `okr_updates` via `okrs.ts`; Mode embeds for OKR dashboards |
| `/dashboard/people` | `leadership` | Inherited from `src/app/dashboard/people/layout.tsx`; page itself does not re-check role | Headcount and org data from Mode-backed loaders in `people.ts` and `chart-data.ts`; Google Sheets org chart link; Mode embeds |
| `/dashboard/people/performance` | `leadership` | Inherited from `src/app/dashboard/people/layout.tsx`; page itself does not re-check role | Mode embed metadata only |
| `/dashboard/people/engagement` | `leadership` | Inherited from `src/app/dashboard/people/layout.tsx`; page itself does not re-check role | Static Culture Amp instructions and external link |
| `/dashboard/admin/status` | `ceo` | Page-level redirect to `/dashboard` in `src/app/dashboard/admin/status/page.tsx` | `sync_log`, `sync_phases`, `mode_reports`, `mode_report_data`, `okr_updates`, `financial_periods`, `squads`, sync config helpers, env vars |
| `/dashboard/admin/squads` | `ceo` | Page-level redirect to `/dashboard` in `src/app/dashboard/admin/squads/page.tsx` | `squads` |

### Dashboard route notes

#### `/dashboard`

- Main overview page for all authenticated users
- Uses role-aware cards:
  - leadership-only metrics and links are wrapped in `PermissionGate`
  - ceo-only ARR and admin details link are wrapped in `PermissionGate`
- Data fallback behavior:
  - most loaders catch errors and render `null`, `[]`, or placeholder states instead of failing the page

#### `/dashboard/unit-economics`

- Leadership-only page
- Redirects unauthorized users back to `/dashboard`
- Renders:
  - LTV:Paid CAC line chart
  - 36-month LTV column chart
  - CPA, spend, and new users time series
  - Mode embeds for KPIs, conversion, retention, COGs/arrears, and growth marketing

#### `/dashboard/financial`

- CEO-only page
- Redirects unauthorized users back to `/dashboard`
- Supports optional search param:
  - `period=<YYYY-MM>` to select a management accounts period
- On data-loader failure it renders an inline warning card instead of throwing

#### `/dashboard/product`

- Leadership-only page
- Redirects unauthorized users back to `/dashboard`
- Renders active-user charts, engagement trend, retention heatmap, and Mode embeds

#### `/dashboard/okrs`

- Available to all authenticated users
- No page-level role redirect
- Renders latest Slack-derived OKR updates grouped by pillar
- Empty state prompts the operator to trigger a Slack sync

#### `/dashboard/people`, `/dashboard/people/performance`, `/dashboard/people/engagement`

- Entire subtree inherits leadership gating from `src/app/dashboard/people/layout.tsx`
- Unauthorized users are redirected to `/dashboard`
- `/dashboard/people` is the only People page that reads structured employee/headcount data
- `/dashboard/people/performance` is currently embed-only
- `/dashboard/people/engagement` is currently static instructional content plus a Culture Amp link

#### `/dashboard/admin/status`

- CEO-only page
- Redirects unauthorized users back to `/dashboard`
- Shows:
  - recent sync runs with phase breakdowns
  - average durations for recent successful runs
  - auto-refresh while any run is effectively queued or running
  - database row counts
  - environment variable presence checks
- Gracefully downgrades when new schema elements like `sync_phases` are not available yet

#### `/dashboard/admin/squads`

- CEO-only page
- Redirects unauthorized users back to `/dashboard`
- Reads all squads, serializes timestamps, and hands them to the client-side admin UI

## Operational Examples

### Trigger cron manually

```bash
curl -X GET \
  "$BASE_URL/api/cron" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Trigger a manual CEO-only sync

```bash
curl -X POST \
  "$BASE_URL/api/sync/slack" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE"
```

### Force a manual CEO-only sync

```bash
curl -X POST \
  "$BASE_URL/api/sync/mode?force=1" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE"
```

### Cancel a sync run

```bash
curl -X POST \
  "$BASE_URL/api/sync/cancel" \
  -H "Content-Type: application/json" \
  -H "Cookie: __session=$CLERK_SESSION_COOKIE" \
  -d '{"syncLogId":42}'
```
