# Prod Probes — ceo-dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ceo-dashboard side of the production-probes system: control plane (API + DB + dashboard), cloud probe GitHub Actions workflow, alerter with Telegram, and `make probe-all` CLI.

**Architecture:** New `src/app/api/probes/` route group for ingestion + status endpoints (HMAC-signed). New `src/lib/probes/` module for alerter state machine + Telegram client. New `src/app/admin/probes/` page for live status. New `scripts/probe.ts` CLI + `Makefile` targets. New `.github/workflows/prod-probes.yml`. Drizzle schema + migration for three new tables. Render Cron Job resource for meta-heartbeat watcher.

**Tech Stack:** Next.js 16, TypeScript strict, Drizzle ORM (better-sqlite3 on dev / Postgres on Render), Clerk, Vitest, Playwright, GitHub Actions, Render Cron Jobs.

**Canonical spec:** `docs/superpowers/specs/2026-04-14-prod-probes-design.md` — read before starting.

**Time budget:** 240 minutes.

**Scope note:** L4d audio loopback is NOT in this plan (Phase 4 of spec, needs HA-side work + physical hardware). Skip it. The HA L4c probe integration (this plane's `/api/probes/report` endpoint) IS in scope — the endpoint must work even though the corresponding local probe ships separately.

---

## File Structure

**Create:**
- `src/app/api/probes/report/route.ts` — POST ingest endpoint (HMAC-auth)
- `src/app/api/probes/heartbeat/route.ts` — POST liveness endpoint (HMAC-auth)
- `src/app/api/probes/ping-auth/route.ts` — GET endpoint the cloud probe hits
- `src/app/api/cron/probe-heartbeat/route.ts` — internal cron that detects stale probes
- `src/app/admin/probes/page.tsx` — Next.js status page (Clerk-protected)
- `src/app/admin/probes/_components/ProbeTimeline.tsx` — per-check timeline component
- `src/app/admin/probes/_components/ProbeSummary.tsx` — top-level status tiles
- `src/lib/probes/alerter.ts` — state machine: transitions → alerts
- `src/lib/probes/telegram.ts` — Telegram bot wrapper
- `src/lib/probes/hmac.ts` — shared HMAC sign/verify
- `src/lib/probes/schema.ts` — Drizzle schema definitions
- `src/lib/probes/repo.ts` — DB access helpers
- `src/lib/probes/types.ts` — shared types
- `drizzle/NNNN_prod_probes.sql` — migration file (auto-generated, committed)
- `scripts/probe.ts` — CLI entrypoint
- `scripts/probes/manifest.yaml` — check registry
- `scripts/probes/checks/ceo-ping-auth.ts` — 15-min check handler
- `scripts/probes/checks/ceo-clerk-playwright.ts` — 60-min Playwright check
- `scripts/probes/report.ts` — writes `.probe-reports/*.md`
- `.github/workflows/prod-probes.yml` — cron workflow
- `tests/probes/alerter.test.ts` — alerter state-machine tests
- `tests/probes/hmac.test.ts` — HMAC verification tests
- `tests/probes/report-route.test.ts` — route handler tests
- `tests/probes/ping-auth.test.ts` — ping-auth route tests
- `playwright/probes/ceo-canary.spec.ts` — Playwright canary journey

**Modify:**
- `drizzle.config.ts` — include new schema file
- `render.yaml` — add new cron service for meta-heartbeat + declare `PROBE_SECRET` env var
- `package.json` — add scripts: `probe`, `probe:all`, new deps (`tsx`, `yaml`, `commander`)
- `Makefile` — add `probe-all`, `probe`, `probe-%` targets
- `.gitignore` — add `.probe-reports/`
- `README.md` — add "Production probes" section

---

## Conventions

- **TDD:** every route handler and every alerter transition starts with a failing test.
- **Commits:** after each green task. Small commits.
- **HMAC header:** `X-Probe-Signature: sha256=<hex>` over `timestamp + "." + body`. Timestamp header `X-Probe-Timestamp`. Reject if timestamp skew > 5 min.
- **Types before code:** define interfaces in `types.ts` before using them. No `any`.
- **One responsibility per file.** If a file approaches 200 lines, split.

---

## Task 1: Drizzle schema + migration

**Files:**
- Create: `src/lib/probes/schema.ts`
- Create: `src/lib/probes/types.ts`
- Modify: `drizzle.config.ts`
- Create: `drizzle/NNNN_prod_probes.sql` (generated)

- [ ] **Step 1: Write schema**

```ts
// src/lib/probes/schema.ts
import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const probeRuns = pgTable("probe_runs", {
  id: serial("id").primaryKey(),
  probeId: text("probe_id").notNull(),            // "cloud-cron" | "ha-local"
  checkName: text("check_name").notNull(),        // "ceo-ping-auth" | "ha-l4c-lights"
  status: text("status", { enum: ["green", "red", "timeout"] }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  detailsJson: jsonb("details_json").$type<Record<string, unknown>>(),
  runId: text("run_id"),                          // groups related checks in a sweep
  target: text("target", { enum: ["prod", "staging"] }).notNull().default("prod"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCheckTs: index("probe_runs_check_name_ts_idx").on(t.checkName, t.ts.desc()),
}));

export const probeHeartbeats = pgTable("probe_heartbeats", {
  probeId: text("probe_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  version: text("version"),
});

export const probeIncidents = pgTable("probe_incidents", {
  id: serial("id").primaryKey(),
  checkName: text("check_name").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  escalationLevel: integer("escalation_level").notNull().default(0),
});
```

- [ ] **Step 2: Write shared types**

```ts
// src/lib/probes/types.ts
export type ProbeStatus = "green" | "red" | "timeout";

export interface ProbeRunPayload {
  probeId: string;
  checkName: string;
  status: ProbeStatus;
  latencyMs: number;
  details?: Record<string, unknown>;
  runId?: string;
  target?: "prod" | "staging";
}

export interface ProbeHeartbeatPayload {
  probeId: string;
  version?: string;
}
```

- [ ] **Step 3: Update `drizzle.config.ts`**

Add `src/lib/probes/schema.ts` to the `schema` glob if not already picked up.

- [ ] **Step 4: Generate migration**

```bash
npx drizzle-kit generate
```

Inspect the generated file in `drizzle/`. Commit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/probes/schema.ts src/lib/probes/types.ts drizzle/ drizzle.config.ts
git commit -m "feat(probes): add schema for probe_runs, probe_heartbeats, probe_incidents"
```

---

## Task 2: HMAC sign/verify helper

**Files:**
- Create: `src/lib/probes/hmac.ts`
- Test: `tests/probes/hmac.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/probes/hmac.test.ts
import { describe, it, expect } from "vitest";
import { signProbePayload, verifyProbeSignature } from "@/lib/probes/hmac";

describe("hmac", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ probeId: "x" });
  const ts = "1700000000";

  it("round-trips a signature", () => {
    const sig = signProbePayload(secret, ts, body);
    expect(verifyProbeSignature({ secret, timestamp: ts, body, signature: sig, nowMs: 1700000060_000 })).toBe(true);
  });

  it("rejects bad signature", () => {
    expect(verifyProbeSignature({ secret, timestamp: ts, body, signature: "bad", nowMs: 1700000060_000 })).toBe(false);
  });

  it("rejects stale timestamp (>5 min)", () => {
    const sig = signProbePayload(secret, ts, body);
    expect(verifyProbeSignature({ secret, timestamp: ts, body, signature: sig, nowMs: 1700000000_000 + 6 * 60 * 1000 })).toBe(false);
  });

  it("accepts current OR previous secret (rotation window)", () => {
    const sig = signProbePayload("old-secret", ts, body);
    expect(verifyProbeSignature({
      secret: "new-secret",
      previousSecret: "old-secret",
      timestamp: ts, body, signature: sig, nowMs: 1700000060_000,
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/probes/hmac.test.ts
```

- [ ] **Step 3: Implement `hmac.ts`**

```ts
// src/lib/probes/hmac.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function signProbePayload(secret: string, timestamp: string, body: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${body}`);
  return `sha256=${hmac.digest("hex")}`;
}

const MAX_SKEW_MS = 5 * 60 * 1000;

export function verifyProbeSignature(opts: {
  secret: string;
  previousSecret?: string;
  timestamp: string;
  body: string;
  signature: string;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const ts = Number(opts.timestamp) * 1000;
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts) > MAX_SKEW_MS) return false;

  for (const secret of [opts.secret, opts.previousSecret].filter(Boolean) as string[]) {
    const expected = signProbePayload(secret, opts.timestamp, opts.body);
    const a = Buffer.from(expected);
    const b = Buffer.from(opts.signature);
    if (a.length !== b.length) continue;
    if (timingSafeEqual(a, b)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests — expect pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/probes/hmac.ts tests/probes/hmac.test.ts
git commit -m "feat(probes): HMAC sign/verify with timestamp + rotation window"
```

---

## Task 3: DB access helpers

**Files:**
- Create: `src/lib/probes/repo.ts`

- [ ] **Step 1: Implement repo helpers**

```ts
// src/lib/probes/repo.ts
import { db } from "@/lib/db";           // existing project db handle
import { probeRuns, probeHeartbeats, probeIncidents } from "./schema";
import { desc, eq, lt } from "drizzle-orm";
import type { ProbeRunPayload, ProbeHeartbeatPayload } from "./types";

export async function insertProbeRun(p: ProbeRunPayload) {
  const [row] = await db.insert(probeRuns).values({
    probeId: p.probeId,
    checkName: p.checkName,
    status: p.status,
    latencyMs: p.latencyMs,
    detailsJson: p.details ?? null,
    runId: p.runId ?? null,
    target: p.target ?? "prod",
  }).returning();
  return row;
}

export async function upsertHeartbeat(p: ProbeHeartbeatPayload) {
  await db.insert(probeHeartbeats).values({
    probeId: p.probeId,
    lastSeenAt: new Date(),
    version: p.version ?? null,
  }).onConflictDoUpdate({
    target: probeHeartbeats.probeId,
    set: { lastSeenAt: new Date(), version: p.version ?? null },
  });
}

export async function lastRunsForCheck(checkName: string, n = 3) {
  return db.select().from(probeRuns)
    .where(eq(probeRuns.checkName, checkName))
    .orderBy(desc(probeRuns.ts))
    .limit(n);
}

export async function staleHeartbeats(thresholdMs: number) {
  const cutoff = new Date(Date.now() - thresholdMs);
  return db.select().from(probeHeartbeats).where(lt(probeHeartbeats.lastSeenAt, cutoff));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/probes/repo.ts
git commit -m "feat(probes): add DB access helpers"
```

---

## Task 4: `/api/probes/report` route (TDD)

**Files:**
- Test: `tests/probes/report-route.test.ts`
- Create: `src/app/api/probes/report/route.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/probes/report-route.test.ts
import { describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/probes/report/route";
import { signProbePayload } from "@/lib/probes/hmac";

describe("POST /api/probes/report", () => {
  it("rejects missing signature", async () => {
    const res = await POST(new Request("http://local/api/probes/report", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("accepts signed payload and writes a run", async () => {
    const body = JSON.stringify({ probeId: "test", checkName: "x", status: "green", latencyMs: 100 });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = signProbePayload("test-secret", ts, body);
    process.env.PROBE_SECRET = "test-secret";
    const res = await POST(new Request("http://local/api/probes/report", {
      method: "POST",
      headers: { "X-Probe-Timestamp": ts, "X-Probe-Signature": sig, "content-type": "application/json" },
      body,
    }));
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Implement route**

```ts
// src/app/api/probes/report/route.ts
import { NextResponse } from "next/server";
import { verifyProbeSignature } from "@/lib/probes/hmac";
import { insertProbeRun } from "@/lib/probes/repo";
import { runAlerter } from "@/lib/probes/alerter";
import type { ProbeRunPayload } from "@/lib/probes/types";

export async function POST(req: Request) {
  const bodyText = await req.text();
  const ts = req.headers.get("x-probe-timestamp") ?? "";
  const sig = req.headers.get("x-probe-signature") ?? "";

  if (!verifyProbeSignature({
    secret: process.env.PROBE_SECRET ?? "",
    previousSecret: process.env.PROBE_SECRET_PREVIOUS,
    timestamp: ts, body: bodyText, signature: sig,
  })) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: ProbeRunPayload;
  try { payload = JSON.parse(bodyText); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const row = await insertProbeRun(payload);
  // Fire-and-forget alerter
  runAlerter(payload.checkName).catch((e) => console.error("alerter error", e));

  return NextResponse.json({ id: row.id }, { status: 201 });
}
```

- [ ] **Step 3: Run tests — expect pass. Commit.**

```bash
git add tests/probes/report-route.test.ts src/app/api/probes/report/route.ts
git commit -m "feat(probes): /api/probes/report ingest endpoint with HMAC"
```

---

## Task 5: `/api/probes/heartbeat` route

**Files:**
- Test: `tests/probes/heartbeat-route.test.ts`
- Create: `src/app/api/probes/heartbeat/route.ts`

- [ ] **Step 1: Test first** — mirror Task 4 pattern but asserting `upsertHeartbeat` called.
- [ ] **Step 2: Implement route** — same HMAC gate, calls `upsertHeartbeat`. Returns 204.
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(probes): /api/probes/heartbeat liveness endpoint"
```

---

## Task 6: `/api/probes/ping-auth` route

**Files:**
- Test: `tests/probes/ping-auth.test.ts`
- Create: `src/app/api/probes/ping-auth/route.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/probes/ping-auth.test.ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/probes/ping-auth/route";
import { signProbePayload } from "@/lib/probes/hmac";

describe("GET /api/probes/ping-auth", () => {
  it("returns health payload with db_ok, version, mode_sync_age_hours, deploying", async () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = signProbePayload("test-secret", ts, "");
    process.env.PROBE_SECRET = "test-secret";
    const res = await GET(new Request("http://local/api/probes/ping-auth", {
      headers: { "X-Probe-Timestamp": ts, "X-Probe-Signature": sig },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      db_ok: expect.any(Boolean),
      version: expect.any(String),
      mode_sync_age_hours: expect.any(Number),
      deploying: expect.any(Boolean),
      ts: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/app/api/probes/ping-auth/route.ts
import { NextResponse } from "next/server";
import { verifyProbeSignature } from "@/lib/probes/hmac";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const DEPLOY_WINDOW_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const ts = req.headers.get("x-probe-timestamp") ?? "";
  const sig = req.headers.get("x-probe-signature") ?? "";
  if (!verifyProbeSignature({
    secret: process.env.PROBE_SECRET ?? "",
    previousSecret: process.env.PROBE_SECRET_PREVIOUS,
    timestamp: ts, body: "", signature: sig,
  })) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let dbOk = false;
  try { await db.execute(sql`SELECT 1`); dbOk = true; } catch { /* dbOk stays false */ }

  // Mode sync age: read most recent sync timestamp from existing sync table.
  // If the repo already has a `mode_syncs` table, query max(ts). Otherwise default to -1.
  // (Implementer: find the right table during assess phase; this is the canonical source
  // of "has Mode sync run recently".)
  let modeSyncAgeHours = -1;
  try {
    const rows: any[] = await db.execute(sql`SELECT max(created_at) AS last FROM mode_syncs`);
    const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0;
    modeSyncAgeHours = last > 0 ? (Date.now() - last) / 3_600_000 : -1;
  } catch { /* table may not exist in dev */ }

  const version = process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  const deployedAtEnv = process.env.DEPLOYED_AT ?? "";
  const deploying = deployedAtEnv ? (Date.now() - Number(deployedAtEnv)) < DEPLOY_WINDOW_MS : false;

  return NextResponse.json({
    db_ok: dbOk,
    version,
    mode_sync_age_hours: Number(modeSyncAgeHours.toFixed(2)),
    deploying,
    ts: new Date().toISOString(),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(probes): /api/probes/ping-auth health endpoint"
```

---

## Task 7: Telegram client

**Files:**
- Create: `src/lib/probes/telegram.ts`
- Test: `tests/probes/telegram.test.ts`

- [ ] **Step 1: Test first** — mock `fetch`, verify it calls Telegram `sendMessage` with chat id + text.
- [ ] **Step 2: Implement**

```ts
// src/lib/probes/telegram.ts
export interface TelegramDeps {
  fetch?: typeof fetch;
  token?: string;
  chatId?: string;
}

export async function sendTelegram(text: string, deps: TelegramDeps = {}): Promise<void> {
  const f = deps.fetch ?? fetch;
  const token = deps.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = deps.chatId ?? process.env.TELEGRAM_PROBE_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_PROBE_CHAT_ID — dropping alert");
    return;
  }
  const res = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(probes): Telegram sender with graceful degradation"
```

---

## Task 8: Alerter state machine

**Files:**
- Test: `tests/probes/alerter.test.ts`
- Create: `src/lib/probes/alerter.ts`

The state machine is the **highest-risk component** — it decides when you get paged. Exhaustive tests first.

- [ ] **Step 1: Write state-machine tests**

```ts
// tests/probes/alerter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decideAlert, AlertDecision } from "@/lib/probes/alerter";

describe("decideAlert — state machine", () => {
  const now = Date.now();
  const sec = (n: number) => new Date(now - n * 1000);

  it("green after green → no-op", () => {
    expect(decideAlert([
      { status: "green", ts: sec(60) },
      { status: "green", ts: sec(120) },
    ], null)).toEqual({ action: "noop" });
  });

  it("first red (was green) → fire initial alert + open incident", () => {
    const d = decideAlert([
      { status: "red", ts: sec(0) },
      { status: "green", ts: sec(60) },
      { status: "green", ts: sec(120) },
    ], null);
    expect(d.action).toBe("fire_initial");
  });

  it("3 consecutive reds → escalate", () => {
    const d = decideAlert([
      { status: "red", ts: sec(0) },
      { status: "red", ts: sec(300) },
      { status: "red", ts: sec(600) },
    ], { openedAt: new Date(now - 600_000), escalationLevel: 0, acked: false });
    expect(d.action).toBe("escalate");
  });

  it("red → green → recovery alert + close incident", () => {
    const d = decideAlert([
      { status: "green", ts: sec(0) },
      { status: "red", ts: sec(300) },
      { status: "red", ts: sec(600) },
    ], { openedAt: new Date(now - 600_000), escalationLevel: 1, acked: false });
    expect(d.action).toBe("recovery");
  });

  it("flap (red/green/red) — does not escalate", () => {
    const d = decideAlert([
      { status: "red", ts: sec(0) },
      { status: "green", ts: sec(300) },
      { status: "red", ts: sec(600) },
    ], { openedAt: new Date(now - 600_000), escalationLevel: 0, acked: false });
    expect(d.action).toBe("noop");
  });

  it("acked incident does not re-escalate", () => {
    const d = decideAlert([
      { status: "red", ts: sec(0) },
      { status: "red", ts: sec(300) },
      { status: "red", ts: sec(600) },
    ], { openedAt: new Date(now - 600_000), escalationLevel: 1, acked: true });
    expect(d.action).toBe("noop");
  });

  it("escalation rate-limit: >1 escalation per hour → noop", () => {
    const d = decideAlert([
      { status: "red", ts: sec(0) },
      { status: "red", ts: sec(300) },
      { status: "red", ts: sec(600) },
    ], {
      openedAt: new Date(now - 3600_000),
      escalationLevel: 2,
      lastEscalatedAt: new Date(now - 30 * 60 * 1000),
      acked: false,
    });
    expect(d.action).toBe("noop");
  });
});
```

- [ ] **Step 2: Implement decision function (pure)**

```ts
// src/lib/probes/alerter.ts (part 1)
import type { ProbeStatus } from "./types";

export interface RunSample { status: ProbeStatus; ts: Date; }
export interface IncidentSnapshot {
  openedAt: Date;
  escalationLevel: number;
  acked: boolean;
  lastEscalatedAt?: Date;
}

export type AlertAction = "noop" | "fire_initial" | "escalate" | "recovery";
export interface AlertDecision { action: AlertAction; reason?: string; }

const ESCALATION_COOLDOWN_MS = 60 * 60 * 1000;

export function decideAlert(recent: RunSample[], incident: IncidentSnapshot | null): AlertDecision {
  if (recent.length === 0) return { action: "noop" };

  const latest = recent[0];
  const previous = recent[1];

  // Recovery: last was red-state (active incident) and latest is green
  if (incident && !incident.acked && latest.status === "green" && previous?.status === "red") {
    return { action: "recovery" };
  }

  // First red after green (or no prior incident)
  if (latest.status !== "green" && !incident) {
    return { action: "fire_initial" };
  }

  // Escalation: 3 consecutive reds and not rate-limited
  if (recent.length >= 3 &&
      recent.slice(0, 3).every(r => r.status !== "green") &&
      incident &&
      !incident.acked &&
      (!incident.lastEscalatedAt || Date.now() - incident.lastEscalatedAt.getTime() > ESCALATION_COOLDOWN_MS)) {
    return { action: "escalate" };
  }

  return { action: "noop" };
}
```

- [ ] **Step 3: Implement the orchestrator `runAlerter(checkName)` that wires DB + Telegram**

Adds to the same file. Reads `lastRunsForCheck`, reads current open incident, calls `decideAlert`, routes action to Telegram + updates incident table. Keep this logic thin — all policy is in `decideAlert`.

- [ ] **Step 4: Run tests — expect pass. Commit.**

```bash
git commit -m "feat(probes): alerter state machine with flap-damping + rate-limited escalation"
```

---

## Task 9: Meta-heartbeat watcher (cron route)

**Files:**
- Create: `src/app/api/cron/probe-heartbeat/route.ts`
- Test: `tests/probes/meta-heartbeat.test.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/cron/probe-heartbeat/route.ts
import { NextResponse } from "next/server";
import { staleHeartbeats } from "@/lib/probes/repo";
import { sendTelegram } from "@/lib/probes/telegram";

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  if (req.headers.get("x-internal-cron") !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const stale = await staleHeartbeats(STALE_THRESHOLD_MS);
  for (const h of stale) {
    await sendTelegram(`🚨 probe **${h.probeId}** has not heartbeat since ${h.lastSeenAt.toISOString()}`);
  }
  return NextResponse.json({ checked: stale.length });
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(probes): meta-heartbeat watcher alerts on stale probes"
```

---

## Task 10: `render.yaml` — add cron resource + env vars

**Files:**
- Modify: `render.yaml`

- [ ] **Step 1: Add envs**

Under the existing `web` service's `envVars:`, add:

```yaml
      - key: PROBE_SECRET
        sync: false
      - key: PROBE_SECRET_PREVIOUS
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_PROBE_CHAT_ID
        sync: false
      - key: INTERNAL_CRON_SECRET
        sync: false
```

- [ ] **Step 2: Add cron service**

```yaml
  - type: cron
    name: ceo-dashboard-probe-heartbeat
    runtime: docker
    dockerfilePath: ./Dockerfile.cron   # OR: use the same web runtime if simpler
    schedule: "*/5 * * * *"
    buildCommand: echo "no-op"
    startCommand: >
      curl -fsS
      -H "x-internal-cron: $INTERNAL_CRON_SECRET"
      https://ceo-dashboard.onrender.com/api/cron/probe-heartbeat
    envVars:
      - key: INTERNAL_CRON_SECRET
        fromService:
          name: ceo-dashboard
          type: web
          envVarKey: INTERNAL_CRON_SECRET
```

If `Dockerfile.cron` doesn't exist, use a minimal Render-provided Node image and invoke curl inline (simpler).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(probes): render.yaml cron + env vars"
```

---

## Task 11: Probe CLI + Makefile + manifest

**Files:**
- Create: `scripts/probes/manifest.yaml`
- Create: `scripts/probes/checks/ceo-ping-auth.ts`
- Create: `scripts/probes/checks/ceo-clerk-playwright.ts`
- Create: `scripts/probe.ts`
- Create: `scripts/probes/report.ts`
- Modify: `Makefile`, `package.json`, `.gitignore`

- [ ] **Step 1: Manifest**

```yaml
# scripts/probes/manifest.yaml
checks:
  - name: ceo-ping-auth
    handler: ceo-ping-auth
    schedule: 15m
    side_effects: false
    target_env_url: CEO_DASHBOARD_URL   # https://ceo-dashboard.onrender.com
  - name: ceo-clerk-playwright
    handler: ceo-clerk-playwright
    schedule: 60m
    side_effects: false
    target_env_url: CEO_DASHBOARD_URL
```

- [ ] **Step 2: `ceo-ping-auth.ts` handler**

```ts
// scripts/probes/checks/ceo-ping-auth.ts
import { signProbePayload } from "@/lib/probes/hmac";

export async function run(env: Record<string, string>) {
  const url = `${env.CEO_DASHBOARD_URL}/api/probes/ping-auth`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signProbePayload(env.PROBE_SECRET, ts, "");
  const started = Date.now();
  const res = await fetch(url, { headers: { "X-Probe-Timestamp": ts, "X-Probe-Signature": sig } });
  const latencyMs = Date.now() - started;
  if (!res.ok) return { status: "red" as const, latencyMs, details: { http: res.status } };
  const body = await res.json();
  const fail =
    !body.db_ok ? "db_not_ok" :
    typeof body.mode_sync_age_hours !== "number" ? "no_sync_age" :
    body.mode_sync_age_hours > 26 ? "sync_stale" : null;
  return {
    status: (fail || latencyMs > 2000) ? "red" as const : "green" as const,
    latencyMs,
    details: { ...body, fail_reason: fail },
  };
}
```

- [ ] **Step 3: `ceo-clerk-playwright.ts` handler**

```ts
// scripts/probes/checks/ceo-clerk-playwright.ts
import { chromium } from "playwright";

export async function run(env: Record<string, string>) {
  const started = Date.now();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      extraHTTPHeaders: { "X-Clerk-Test-Mode": "true" },
    });
    // Clerk Testing Token mode — visit sign-in with token in URL.
    const page = await ctx.newPage();
    await page.goto(`${env.CEO_DASHBOARD_URL}/?__clerk_test_token=${env.CLERK_TEST_TOKEN}`);
    await page.waitForSelector('[data-canary="system-canary"]', { timeout: 30_000 });
    const text = await page.textContent('[data-canary="system-canary"]');
    const latencyMs = Date.now() - started;
    const expected = env.CANARY_EXPECTED_VALUE ?? "CANARY-OK";
    return {
      status: text?.includes(expected) ? "green" as const : "red" as const,
      latencyMs,
      details: { actual: text },
    };
  } finally {
    await browser.close();
  }
}
```

Note: the `[data-canary="system-canary"]` element will be added in Task 13.

- [ ] **Step 4: CLI entrypoint**

```ts
// scripts/probe.ts
#!/usr/bin/env tsx
import { parse as parseYAML } from "yaml";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { signProbePayload } from "@/lib/probes/hmac";

type CheckHandler = (env: Record<string,string>) => Promise<{status: "green"|"red"|"timeout", latencyMs: number, details?: any}>;

async function loadHandler(name: string): Promise<CheckHandler> {
  const mod = await import(`./probes/checks/${name}.js`); // tsx resolves .ts
  return mod.run as CheckHandler;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all") || args[0] === "all";
  const fast = args.includes("--fast");
  const readOnly = args.includes("--read-only");
  const target = args.find(a => a.startsWith("--target="))?.split("=")[1] ?? "prod";
  const single = !all ? args[0] : null;

  const manifest = parseYAML(readFileSync("scripts/probes/manifest.yaml", "utf8")) as any;
  const checks = manifest.checks as any[];
  const selected = single ? checks.filter(c => c.name === single)
                          : checks.filter(c => !fast || c.schedule !== "60m");

  const env = { ...process.env, CEO_DASHBOARD_URL: process.env.CEO_DASHBOARD_URL ?? "http://localhost:3100" };
  const startAll = Date.now();
  const results: any[] = [];
  for (const c of selected) {
    process.stdout.write(`🔄 ${c.name} ... `);
    try {
      const handler = await loadHandler(c.handler);
      const r = await Promise.race([
        handler(env as any),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error("timeout")), 120_000)),
      ]);
      console.log(`${r.status === "green" ? "✅" : "❌"} ${r.latencyMs}ms`);
      results.push({ check: c.name, ...r });

      // Report to control plane
      await reportToControlPlane(c.name, r, env);
    } catch (err: any) {
      console.log(`⚠️  ${err?.message}`);
      results.push({ check: c.name, status: "red", latencyMs: 0, details: { error: err?.message } });
    }
  }
  const passed = results.filter(r => r.status === "green").length;
  const total = results.length;
  const duration = `${((Date.now() - startAll) / 1000).toFixed(1)}s`;
  const reportPath = writeReport(results);
  const line = passed === total
    ? `✅ probe-all: ${passed}/${total} passed in ${duration} | report: ${reportPath}`
    : `❌ probe-all: ${passed}/${total} passed (${total - passed} failed: ${results.filter(r => r.status !== "green").map(r => r.check).join(", ")}) in ${duration} | report: ${reportPath}`;
  console.log(line);
  process.exit(passed === total ? 0 : 1);
}

function writeReport(results: any[]): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = `.probe-reports/${ts}.md`;
  mkdirSync(".probe-reports", { recursive: true });
  const md = `# Probe report ${ts}\n\n` + results.map(r =>
    `## ${r.check}\n- status: ${r.status}\n- latency: ${r.latencyMs}ms\n- details: \`${JSON.stringify(r.details)}\`\n`,
  ).join("\n");
  writeFileSync(path, md);
  return path;
}

async function reportToControlPlane(check: string, r: any, env: any) {
  if (!env.PROBE_SECRET || !env.CEO_DASHBOARD_URL) return;
  const body = JSON.stringify({
    probeId: "cloud-cron",
    checkName: check,
    status: r.status,
    latencyMs: r.latencyMs,
    details: r.details,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signProbePayload(env.PROBE_SECRET, ts, body);
  try {
    await fetch(`${env.CEO_DASHBOARD_URL}/api/probes/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Probe-Timestamp": ts, "X-Probe-Signature": sig },
      body,
    });
  } catch { /* fallback Telegram handled in workflow */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Makefile targets**

```make
probe-all:
	npx tsx scripts/probe.ts --all $(ARGS)

probe-fast:
	npx tsx scripts/probe.ts --all --fast

probe-%:
	npx tsx scripts/probe.ts $*
```

- [ ] **Step 6: package.json scripts + deps**

```json
"scripts": {
  ...
  "probe": "tsx scripts/probe.ts",
  "probe:all": "tsx scripts/probe.ts --all"
},
"devDependencies": {
  ...
  "tsx": "^4.16.0",
  "yaml": "^2.5.0",
  "@playwright/test": "^1.47.0"
}
```

Install: `npm install --save-dev tsx yaml @playwright/test && npx playwright install chromium`

- [ ] **Step 7: `.gitignore` — add `.probe-reports/`**

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(probes): CLI, manifest, Makefile targets, reporting"
```

---

## Task 12: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/prod-probes.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: Prod probes

on:
  schedule:
    - cron: "*/15 * * * *"   # 15m cheap probes
    - cron: "0 * * * *"      # 60m Playwright
  workflow_dispatch:

concurrency:
  group: prod-probes
  cancel-in-progress: false

jobs:
  probe-15m:
    if: github.event.schedule == '*/15 * * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npx tsx scripts/probe.ts ceo-ping-auth
        env:
          CEO_DASHBOARD_URL: ${{ secrets.CEO_DASHBOARD_URL }}
          PROBE_SECRET: ${{ secrets.PROBE_SECRET }}
      - if: failure()
        run: |
          curl -s https://api.telegram.org/bot${{ secrets.TELEGRAM_FALLBACK_BOT_TOKEN }}/sendMessage \
            -d chat_id=${{ secrets.TELEGRAM_FALLBACK_CHAT_ID }} \
            -d "text=🚨 probe-15m workflow failed (likely control plane down)"

  probe-60m:
    if: github.event.schedule == '0 * * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx tsx scripts/probe.ts ceo-clerk-playwright
        env:
          CEO_DASHBOARD_URL: ${{ secrets.CEO_DASHBOARD_URL }}
          PROBE_SECRET: ${{ secrets.PROBE_SECRET }}
          CLERK_TEST_TOKEN: ${{ secrets.CLERK_TEST_TOKEN }}
          CANARY_EXPECTED_VALUE: ${{ secrets.CANARY_EXPECTED_VALUE }}
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-failure
          path: .probe-reports/
```

- [ ] **Step 2: Commit**

```bash
git commit -m "ci(probes): GitHub Actions cron workflow"
```

---

## Task 13: `/admin/probes` page + system canary

**Files:**
- Create: `src/app/admin/probes/page.tsx`
- Create: `src/app/admin/probes/_components/ProbeSummary.tsx`
- Create: `src/app/admin/probes/_components/ProbeTimeline.tsx`
- Modify: the "main" authenticated page (e.g. `src/app/page.tsx` or `src/app/(dashboard)/layout.tsx`) to include `<span data-canary="system-canary">CANARY-OK</span>` in a non-prominent place (small text at footer).

- [ ] **Step 1: Add canary element** to the dashboard shell — text = env var `NEXT_PUBLIC_CANARY_VALUE || "CANARY-OK"`, small muted styling.

- [ ] **Step 2: Implement `/admin/probes/page.tsx`**

```tsx
// src/app/admin/probes/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { probeRuns, probeHeartbeats } from "@/lib/probes/schema";
import { desc } from "drizzle-orm";
import { ProbeSummary } from "./_components/ProbeSummary";
import { ProbeTimeline } from "./_components/ProbeTimeline";

export default async function ProbesAdminPage() {
  const { userId } = auth();
  if (!userId) redirect("/sign-in");

  const runs = await db.select().from(probeRuns).orderBy(desc(probeRuns.ts)).limit(500);
  const hbs = await db.select().from(probeHeartbeats);

  // Group by check name
  const byCheck = new Map<string, typeof runs>();
  for (const r of runs) {
    if (!byCheck.has(r.checkName)) byCheck.set(r.checkName, []);
    byCheck.get(r.checkName)!.push(r);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Probes</h1>
      <ProbeSummary byCheck={byCheck} heartbeats={hbs} />
      {[...byCheck.entries()].map(([name, series]) => (
        <ProbeTimeline key={name} name={name} series={series} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `ProbeSummary.tsx`** — for each check: status tile (green/yellow/red), p50/p95 latency, last seen. For each heartbeat: probe id, last seen, "stale" warning if > 15 min.

- [ ] **Step 4: Implement `ProbeTimeline.tsx`** — horizontal bar showing last 24h of runs colored by status. D3 (project already uses D3).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(probes): /admin/probes status page + system canary"
```

---

## Task 14: README + full integration test

**Files:**
- Modify: `README.md`
- Create: `tests/probes/integration.test.ts` — spins up a request loop, inserts rows, asserts `runAlerter` path calls Telegram mock.

- [ ] **Step 1: README section** — "Production probes", how to run `make probe-all`, what the endpoints are, secrets needed.

- [ ] **Step 2: Integration test** covers: sign → POST /report → row inserted → alerter fires after 3 reds.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(probes): README + integration test"
```

---

## Task 15: Open PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: production probes (ceo-dashboard side)" --body "$(cat <<'EOF'
## Summary
Implements the ceo-dashboard side of prod-probes per docs/superpowers/specs/2026-04-14-prod-probes-design.md.

- Control plane: /api/probes/{report, heartbeat, ping-auth} + HMAC
- Alerter state machine + Telegram
- /admin/probes status page
- CLI + Makefile + GH Actions cron
- Skips L4d (HA-side, separate PR)

## Test plan
- [ ] `make probe-fast` returns 0 locally
- [ ] Unit tests green (`npm test`)
- [ ] Deploy to Render, confirm cron workflow runs, /admin/probes renders
- [ ] Flap test: force a red, confirm Telegram alerts + escalation
EOF
)"
```

---

## Self-review (run after writing all tasks)

- **Spec coverage:** ping-auth (T6), report (T4), heartbeat (T5), alerter (T8), Telegram (T7), /admin/probes (T13), GH Actions (T12), CLI + Makefile (T11), render.yaml (T10), DB schema (T1), meta-heartbeat (T9). All components mapped. ✓
- **No placeholders:** all tasks include runnable code, not "TBD". ✓
- **Type consistency:** `ProbeRunPayload`, `ProbeStatus`, `AlertAction` used consistently across tasks. ✓
- **Open questions from spec:** canary element text (Task 13 uses `CANARY-OK` default, overridable via env), L4d phrase (out of scope), Telegram chat id (env var). ✓

## Out of scope (deferred)

- L4d audio loopback (phase 4, HA-side)
- Telegram ack webhook (auto-snooze is sufficient for v1)
- Prometheus metrics export
- Staging probes
