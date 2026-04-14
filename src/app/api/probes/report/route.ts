import { NextResponse } from "next/server";
import { verifyPayload } from "@/lib/probes/hmac";
import { insertProbeRun } from "@/lib/probes/repo";
import { runAlerter } from "@/lib/probes/alerter";
import type { ProbeStatus } from "@/lib/probes/types";

const VALID_STATUSES = new Set<string>(["green", "red", "timeout"]);

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("X-Probe-Signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing X-Probe-Signature header" },
      { status: 401 }
    );
  }

  const tsHeader = request.headers.get("X-Probe-Timestamp");
  if (!tsHeader) {
    return NextResponse.json(
      { error: "Missing X-Probe-Timestamp header" },
      { status: 401 }
    );
  }

  const secret = process.env.PROBE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Probe secret not configured" },
      { status: 401 }
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
  }

  const ts = Number(tsHeader);
  const prevSecret = process.env.PROBE_SECRET_PREVIOUS || undefined;

  if (!verifyPayload(rawBody, signature, ts, secret, prevSecret)) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: "Missing required fields: probeId, checkName, status, latencyMs" },
      { status: 400 }
    );
  }

  const row = await insertProbeRun({
    probeId: body.probeId,
    checkName: body.checkName,
    status: body.status as ProbeStatus,
    latencyMs: body.latencyMs,
    details: body.details,
    runId: body.runId,
    target: body.target,
  });

  runAlerter(body.checkName).catch(() => {});

  return NextResponse.json({ id: row.id, ts: row.ts }, { status: 201 });
}

interface ValidPayload {
  probeId: string;
  checkName: string;
  status: string;
  latencyMs: number;
  details?: Record<string, unknown>;
  runId?: string;
  target?: "prod" | "staging";
}

function isValidPayload(body: unknown): body is ValidPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.probeId === "string" &&
    typeof b.checkName === "string" &&
    typeof b.status === "string" &&
    VALID_STATUSES.has(b.status) &&
    typeof b.latencyMs === "number"
  );
}
