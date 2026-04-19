import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withDbErrorContext } from "@/lib/db/errors";
import {
  SYNC_SOURCES,
  getSyncSourceConfig,
  type SyncSource,
} from "./config";

export interface SourceHealth {
  source: SyncSource;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  totalRuns7d: number;
  successRuns7d: number;
  successRate7d: number | null;
  p95DurationMs: number | null;
}

export interface StalledSource {
  source: SyncSource;
  lastSuccessAt: Date;
  thresholdMs: number;
  ageMs: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const STALLED_MULTIPLIER = 5;

function isSyncSource(value: unknown): value is SyncSource {
  return (
    typeof value === "string" &&
    (SYNC_SOURCES as readonly string[]).includes(value)
  );
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

export async function getSourceHealth(
  now: Date = new Date()
): Promise<SourceHealth[]> {
  // postgres-js chokes on raw Date params inside drizzle sql templates
  // (no column-type hint → "string argument must be string/Buffer, received Date").
  // Send an ISO string cast to timestamptz server-side instead.
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();

  // lastSuccessAt / lastFailureAt are all-time — a source that broke 10 days ago
  // must still appear as "last success 10d ago", not "never". The 7-day window
  // only constrains the rolling success-rate / p95 aggregates below.
  const rows = await withDbErrorContext("getSourceHealth", async () =>
    db.execute(sql`
      SELECT
        source,
        MAX(CASE WHEN status IN ('success','partial') THEN completed_at END) AS last_success_at,
        MAX(CASE WHEN status IN ('error','cancelled') THEN completed_at END) AS last_failure_at,
        COUNT(*) FILTER (
          WHERE completed_at IS NOT NULL
            AND started_at >= ${windowStart}::timestamptz
        )::int AS total_runs,
        COUNT(*) FILTER (
          WHERE status IN ('success','partial')
            AND started_at >= ${windowStart}::timestamptz
        )::int AS success_runs,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
        ) FILTER (
          WHERE completed_at IS NOT NULL
            AND status IN ('success','partial')
            AND started_at >= ${windowStart}::timestamptz
        ) AS p95_duration_ms
      FROM sync_log
      GROUP BY source
    `)
  );

  const bySource = new Map<SyncSource, SourceHealth>();
  for (const source of SYNC_SOURCES) {
    bySource.set(source, {
      source,
      lastSuccessAt: null,
      lastFailureAt: null,
      totalRuns7d: 0,
      successRuns7d: 0,
      successRate7d: null,
      p95DurationMs: null,
    });
  }

  for (const row of rows as Iterable<Record<string, unknown>>) {
    if (!isSyncSource(row.source)) continue;
    const totalRuns = toNumber(row.total_runs);
    const successRuns = toNumber(row.success_runs);
    bySource.set(row.source, {
      source: row.source,
      lastSuccessAt: toDate(row.last_success_at),
      lastFailureAt: toDate(row.last_failure_at),
      totalRuns7d: totalRuns,
      successRuns7d: successRuns,
      successRate7d: totalRuns > 0 ? successRuns / totalRuns : null,
      p95DurationMs: toNullableNumber(row.p95_duration_ms),
    });
  }

  return SYNC_SOURCES.map((source) => bySource.get(source)!);
}

export function detectStalledSources(
  healths: readonly SourceHealth[],
  now: Date = new Date()
): StalledSource[] {
  const stalled: StalledSource[] = [];
  for (const health of healths) {
    if (!health.lastSuccessAt) continue;
    const thresholdMs =
      getSyncSourceConfig(health.source).normalIntervalMs * STALLED_MULTIPLIER;
    const ageMs = now.getTime() - health.lastSuccessAt.getTime();
    if (ageMs > thresholdMs) {
      stalled.push({
        source: health.source,
        lastSuccessAt: health.lastSuccessAt,
        thresholdMs,
        ageMs,
      });
    }
  }
  return stalled;
}

export function emitStalledSourceWarnings(stalled: readonly StalledSource[]): void {
  for (const entry of stalled) {
    Sentry.captureMessage(
      `Sync source "${entry.source}" has not succeeded within ${STALLED_MULTIPLIER}x its normal interval`,
      {
        level: "warning",
        tags: { sync_stalled: "true", source: entry.source },
        extra: {
          source: entry.source,
          lastSuccessAt: entry.lastSuccessAt.toISOString(),
          thresholdMs: entry.thresholdMs,
          ageMs: entry.ageMs,
        },
      }
    );
  }
}
