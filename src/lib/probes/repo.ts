import { db } from "@/lib/db";
import {
  probeRuns,
  probeHeartbeats,
  probeIncidents,
} from "@/lib/db/schema";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { ProbeRunPayload } from "./types";

export async function insertProbeRun(payload: ProbeRunPayload) {
  const [row] = await db
    .insert(probeRuns)
    .values({
      probeId: payload.probeId,
      checkName: payload.checkName,
      status: payload.status,
      latencyMs: payload.latencyMs,
      detailsJson: payload.details ?? null,
      runId: payload.runId ?? null,
      target: payload.target ?? "prod",
    })
    .returning({ id: probeRuns.id, ts: probeRuns.ts });
  return row;
}

export async function upsertHeartbeat(probeId: string, version?: string) {
  await db
    .insert(probeHeartbeats)
    .values({
      probeId,
      lastSeenAt: new Date(),
      version: version ?? null,
    })
    .onConflictDoUpdate({
      target: probeHeartbeats.probeId,
      set: {
        lastSeenAt: new Date(),
        version: version ?? null,
      },
    });
}

export async function lastRunsForCheck(
  checkName: string,
  limit = 5
) {
  return db
    .select()
    .from(probeRuns)
    .where(eq(probeRuns.checkName, checkName))
    .orderBy(desc(probeRuns.ts))
    .limit(limit);
}

export async function allHeartbeats() {
  return db.select().from(probeHeartbeats);
}

export async function staleHeartbeats(thresholdMinutes = 15) {
  const cutoff = sql`now() - interval '1 minute' * ${thresholdMinutes}`;
  return db
    .select()
    .from(probeHeartbeats)
    .where(lt(probeHeartbeats.lastSeenAt, cutoff));
}

export async function openIncident(
  checkName: string,
  escalationLevel = 0
): Promise<{ id: number } | null> {
  const now = new Date();
  const [row] = await db
    .insert(probeIncidents)
    .values({
      checkName,
      openedAt: now,
      escalationLevel,
      lastAlertedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: probeIncidents.id });
  return row ?? null;
}

export async function closeIncident(incidentId: number): Promise<boolean> {
  const rows = await db
    .update(probeIncidents)
    .set({ closedAt: new Date() })
    .where(
      and(
        eq(probeIncidents.id, incidentId),
        isNull(probeIncidents.closedAt)
      )
    )
    .returning({ id: probeIncidents.id });
  return rows.length > 0;
}

export async function openIncidentForCheck(checkName: string) {
  const [row] = await db
    .select()
    .from(probeIncidents)
    .where(
      and(
        eq(probeIncidents.checkName, checkName),
        isNull(probeIncidents.closedAt)
      )
    )
    .orderBy(desc(probeIncidents.openedAt))
    .limit(1);
  return row ?? null;
}

export async function escalateIncident(
  incidentId: number,
  level: number,
  lastAlertedAt: Date = new Date()
): Promise<boolean> {
  const rows = await db
    .update(probeIncidents)
    .set({ escalationLevel: level, lastAlertedAt })
    .where(
      and(
        eq(probeIncidents.id, incidentId),
        isNull(probeIncidents.closedAt),
        lt(probeIncidents.escalationLevel, level)
      )
    )
    .returning({ id: probeIncidents.id });
  return rows.length > 0;
}

export async function setLastAlertedAt(
  incidentId: number,
  at: Date
): Promise<boolean> {
  const rows = await db
    .update(probeIncidents)
    .set({ lastAlertedAt: at })
    .where(
      and(
        eq(probeIncidents.id, incidentId),
        isNull(probeIncidents.closedAt),
        lt(probeIncidents.lastAlertedAt, at)
      )
    )
    .returning({ id: probeIncidents.id });
  return rows.length > 0;
}
