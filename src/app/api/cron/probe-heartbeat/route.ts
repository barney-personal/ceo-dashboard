import { NextResponse } from "next/server";
import {
  allHeartbeats,
  insertProbeRun,
  openIncidentForCheck,
} from "@/lib/probes/repo";
import { runAlerter } from "@/lib/probes/alerter";

const STALE_THRESHOLD_MINUTES = 15;

function syntheticCheckName(probeId: string): string {
  return `heartbeat:${probeId}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.INTERNAL_CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const heartbeats = await allHeartbeats();
  const now = Date.now();
  const cutoff = now - STALE_THRESHOLD_MINUTES * 60_000;

  const stale: string[] = [];
  const recovered: string[] = [];

  for (const hb of heartbeats) {
    const checkName = syntheticCheckName(hb.probeId);
    const isStale = hb.lastSeenAt.getTime() < cutoff;

    if (isStale) {
      const staleMins = Math.round((now - hb.lastSeenAt.getTime()) / 60_000);
      try {
        await insertProbeRun({
          probeId: hb.probeId,
          checkName,
          status: "red",
          latencyMs: 0,
          details: { reason: `no heartbeat for ${staleMins} min` },
        });
        await runAlerter(checkName);
      } catch {
        // Continue processing other heartbeats
      }
      stale.push(hb.probeId);
    } else {
      const incident = await openIncidentForCheck(checkName);
      if (incident) {
        try {
          await insertProbeRun({
            probeId: hb.probeId,
            checkName,
            status: "green",
            latencyMs: 0,
            details: { reason: "heartbeat recovered" },
          });
          await runAlerter(checkName);
        } catch {
          // Continue processing other heartbeats
        }
        recovered.push(hb.probeId);
      }
    }
  }

  return NextResponse.json({ stale, recovered });
}
