import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { pageViews } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = body.path;
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const sanitizedPath = path.slice(0, 500);
  const now = new Date();
  const hourBucket = now.toISOString().slice(0, 13); // "2026-04-10T14"

  await db
    .insert(pageViews)
    .values({
      clerkUserId: userId,
      path: sanitizedPath,
      hourBucket,
    })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
