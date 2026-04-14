import {
  closeIncident,
  escalateIncident,
  lastRunsForCheck,
  openIncident,
  openIncidentForCheck,
  setLastAlertedAt,
} from "./repo";
import { sendTelegram } from "./telegram";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertRun {
  status: string;
  ts: Date;
  detailsJson?: unknown;
}

export interface AlertIncident {
  id: number;
  openedAt: Date;
  escalationLevel: number;
  lastAlertedAt: Date | null;
}

export type AlertDecision =
  | { action: "none" }
  | { action: "open_incident"; message: string }
  | { action: "escalate"; incidentId: number; level: number; message: string }
  | { action: "recover"; incidentId: number; message: string }
  | { action: "remind"; incidentId: number; message: string };

// ---------------------------------------------------------------------------
// Pure decision function
// ---------------------------------------------------------------------------

const REMINDER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function decideAlert(
  checkName: string,
  recentRuns: AlertRun[],
  openIncident: AlertIncident | null,
  now: Date = new Date(),
  reminderIntervalMs = REMINDER_INTERVAL_MS
): AlertDecision {
  if (recentRuns.length === 0) {
    return { action: "none" };
  }

  const latest = recentRuns[0];
  const isFailure =
    latest.status === "red" || latest.status === "timeout";

  // Green run
  if (!isFailure) {
    if (openIncident) {
      const durationMs = now.getTime() - openIncident.openedAt.getTime();
      const durationMin = Math.round(durationMs / 60_000);
      return {
        action: "recover",
        incidentId: openIncident.id,
        message: `✅ ${checkName} recovered after ${durationMin} min`,
      };
    }
    return { action: "none" };
  }

  // Failure with no open incident → fire first alert
  if (!openIncident) {
    const reason = extractReason(latest);
    return {
      action: "open_incident",
      message: `🚨 ${checkName} failed${reason ? `: ${reason}` : ""}`,
    };
  }

  // Failure with open incident
  const consecutiveFailures = countConsecutiveFailures(recentRuns);

  if (openIncident.escalationLevel === 0 && consecutiveFailures >= 3) {
    const durationMs = now.getTime() - openIncident.openedAt.getTime();
    const durationMin = Math.round(durationMs / 60_000);
    return {
      action: "escalate",
      incidentId: openIncident.id,
      level: 1,
      message: `⚠️ ${checkName} red for ${durationMin} min — still failing`,
    };
  }

  // Reminder rate limiting
  const lastAlert = openIncident.lastAlertedAt ?? openIncident.openedAt;
  const timeSinceLastAlert = now.getTime() - lastAlert.getTime();

  if (timeSinceLastAlert >= reminderIntervalMs) {
    return {
      action: "remind",
      incidentId: openIncident.id,
      message: `⚠️ ${checkName} still failing — reminder`,
    };
  }

  return { action: "none" };
}

function countConsecutiveFailures(runs: AlertRun[]): number {
  let count = 0;
  for (const r of runs) {
    if (r.status === "red" || r.status === "timeout") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function extractReason(run: AlertRun): string | null {
  if (!run.detailsJson || typeof run.detailsJson !== "object") return null;
  const d = run.detailsJson as Record<string, unknown>;
  if (typeof d.reason === "string") return d.reason;
  if (typeof d.error === "string") return d.error;
  return null;
}

// ---------------------------------------------------------------------------
// Wired runner (calls repo + telegram)
// ---------------------------------------------------------------------------

export async function runAlerter(checkName: string): Promise<void> {
  const [recentRuns, currentIncident] = await Promise.all([
    lastRunsForCheck(checkName, 5),
    openIncidentForCheck(checkName),
  ]);

  const now = new Date();
  const decision = decideAlert(
    checkName,
    recentRuns.map((r) => ({
      status: r.status,
      ts: r.ts,
      detailsJson: r.detailsJson,
    })),
    currentIncident
      ? {
          id: currentIncident.id,
          openedAt: currentIncident.openedAt,
          escalationLevel: currentIncident.escalationLevel,
          lastAlertedAt: (currentIncident as Record<string, unknown>).lastAlertedAt as Date | null ?? null,
        }
      : null,
    now
  );

  switch (decision.action) {
    case "none":
      return;

    case "open_incident": {
      // onConflictDoNothing in repo ensures at most one open incident per check
      const incident = await openIncident(checkName, 0);
      if (!incident) {
        // Concurrent caller already opened the incident — skip duplicate alert
        return;
      }
      await sendTelegram(decision.message);
      return;
    }

    case "escalate": {
      const changed = await escalateIncident(decision.incidentId, decision.level, now);
      if (changed) await sendTelegram(decision.message);
      return;
    }

    case "recover": {
      const changed = await closeIncident(decision.incidentId);
      if (changed) await sendTelegram(decision.message);
      return;
    }

    case "remind": {
      const changed = await setLastAlertedAt(decision.incidentId, now);
      if (changed) await sendTelegram(decision.message);
      return;
    }
  }
}
