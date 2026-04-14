import { NextResponse } from "next/server";
import { verifyPayload } from "@/lib/probes/hmac";
import { upsertHeartbeat } from "@/lib/probes/repo";

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

  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).probeId !== "string") {
    return NextResponse.json(
      { error: "Missing required field: probeId" },
      { status: 400 }
    );
  }

  const { probeId, version } = body as { probeId: string; version?: string };

  await upsertHeartbeat(probeId, version);

  return new NextResponse(null, { status: 204 });
}
