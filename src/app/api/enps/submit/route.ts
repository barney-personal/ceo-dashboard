import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { submitEnpsResponse } from "@/lib/data/enps";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { score?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return NextResponse.json(
      { error: "Score must be an integer 0-10" },
      { status: 400 }
    );
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason
      : null;

  try {
    const inserted = await submitEnpsResponse(userId, score, reason);
    return NextResponse.json({ ok: true, inserted });
  } catch (err) {
    console.error("enps submit failed", err);
    return NextResponse.json(
      { error: "Failed to save response" },
      { status: 500 }
    );
  }
}
