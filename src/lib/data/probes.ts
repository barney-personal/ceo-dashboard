import { db } from "@/lib/db";
import { probeRuns } from "@/lib/db/schema";
import { desc, gte, sql } from "drizzle-orm";
import {
  allHeartbeats,
  lastRunsForCheck,
  openIncidentForCheck,
} from "@/lib/probes/repo";

export const STALE_HEARTBEAT_MINUTES = 15;

const RUN_HISTORY_LIMIT = 200;

export interface ProbeCheckSummary {
  checkName: string;
  latestStatus: string | null;
  latestRunTs: Date | null;
  heartbeatFresh: boolean;
  heartbeatLastSeen: Date | null;
  heartbeatVersion: string | null;
  openIncident: {
    id: number;
    escalationLevel: number;
    openedAt: Date;
  } | null;
  uptimePercent7d: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  recentRedEvents: Array<{
    ts: Date;
    latencyMs: number;
    details: unknown;
  }>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export async function getProbeStatusSummary(
  checkNames: string[],
  now: Date = new Date(),
): Promise<ProbeCheckSummary[]> {
  const heartbeats = await allHeartbeats();
  const heartbeatMap = new Map(
    heartbeats.map((h: { probeId: string; lastSeenAt: Date; version: string | null }) => [
      h.probeId,
      h,
    ]),
  );

  const staleCutoff = new Date(
    now.getTime() - STALE_HEARTBEAT_MINUTES * 60_000,
  );

  const results: ProbeCheckSummary[] = [];

  for (const checkName of checkNames) {
    const [runs, incident] = await Promise.all([
      lastRunsForCheck(checkName, RUN_HISTORY_LIMIT),
      openIncidentForCheck(checkName),
    ]);

    const latestRun = runs[0] ?? null;

    // Find matching heartbeat — any heartbeat counts (probeId is the runner identity)
    const heartbeat = heartbeatMap.values().next().value ?? null;
    const heartbeatFresh = heartbeat
      ? heartbeat.lastSeenAt >= staleCutoff
      : false;

    // Uptime: percentage of green runs out of total
    const uptimePercent7d =
      runs.length > 0
        ? Math.round(
            (runs.filter((r: { status: string }) => r.status === "green").length /
              runs.length) *
              100,
          )
        : null;

    // Latency percentiles from green runs
    const latencies = runs
      .filter((r: { status: string }) => r.status === "green")
      .map((r: { latencyMs: number }) => r.latencyMs)
      .sort((a: number, b: number) => a - b);

    const latencyP50 = latencies.length > 0 ? percentile(latencies, 50) : null;
    const latencyP95 = latencies.length > 0 ? percentile(latencies, 95) : null;

    // Recent red events (up to 10)
    const recentRedEvents = runs
      .filter((r: { status: string }) => r.status === "red")
      .slice(0, 10)
      .map((r: { ts: Date; latencyMs: number; detailsJson: unknown }) => ({
        ts: r.ts,
        latencyMs: r.latencyMs,
        details: r.detailsJson,
      }));

    results.push({
      checkName,
      latestStatus: latestRun?.status ?? null,
      latestRunTs: latestRun?.ts ?? null,
      heartbeatFresh,
      heartbeatLastSeen: heartbeat?.lastSeenAt ?? null,
      heartbeatVersion: heartbeat?.version ?? null,
      openIncident: incident
        ? {
            id: incident.id,
            escalationLevel: incident.escalationLevel,
            openedAt: incident.openedAt,
          }
        : null,
      uptimePercent7d,
      latencyP50,
      latencyP95,
      recentRedEvents,
    });
  }

  return results;
}

export async function getProbeTimeline(hours = 24) {
  const cutoff = sql`now() - interval '1 hour' * ${hours}`;
  return db
    .select()
    .from(probeRuns)
    .where(gte(probeRuns.ts, cutoff))
    .orderBy(desc(probeRuns.ts))
    .limit(500);
}
