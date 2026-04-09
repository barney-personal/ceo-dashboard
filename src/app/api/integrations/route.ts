import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { syncGranolaNotes } from "@/lib/sync/meetings";

async function getAuthenticatedUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * GET /api/integrations — returns current user's integration statuses.
 */
export async function GET() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({ provider: userIntegrations.provider, updatedAt: userIntegrations.updatedAt })
    .from(userIntegrations)
    .where(eq(userIntegrations.clerkUserId, userId));

  const integrations: Record<string, { connected: boolean; updatedAt: string }> = {};
  for (const row of rows) {
    integrations[row.provider] = {
      connected: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return NextResponse.json({ integrations });
}

/**
 * PUT /api/integrations — saves or updates an API key for a provider.
 * Body: { provider: "granola", apiKey: "grn_..." }
 */
export async function PUT(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { provider?: string; apiKey?: string };
  if (!body.provider || !body.apiKey) {
    return NextResponse.json(
      { error: "provider and apiKey are required" },
      { status: 400 }
    );
  }

  if (body.provider !== "granola") {
    return NextResponse.json(
      { error: "Unsupported provider" },
      { status: 400 }
    );
  }

  // Validate the key by making a test API call
  try {
    const res = await fetch("https://public-api.granola.ai/v1/notes?limit=1", {
      headers: { Authorization: `Bearer ${body.apiKey}` },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Invalid Granola API key" },
        { status: 422 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not validate Granola API key" },
      { status: 422 }
    );
  }

  await db
    .insert(userIntegrations)
    .values({
      clerkUserId: userId,
      provider: body.provider,
      apiKey: body.apiKey,
    })
    .onConflictDoUpdate({
      target: [userIntegrations.clerkUserId, userIntegrations.provider],
      set: {
        apiKey: body.apiKey,
        updatedAt: new Date(),
      },
    });

  // Trigger an immediate sync of the user's Granola notes
  let notesSynced = 0;
  try {
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // last 90 days
    const result = await syncGranolaNotes(sinceDate, { token: body.apiKey });
    notesSynced = result.count;
  } catch {
    // Sync failure shouldn't fail the key save
  }

  return NextResponse.json({ status: "connected", notesSynced });
}

/**
 * DELETE /api/integrations — disconnects a provider.
 * Body: { provider: "granola" }
 */
export async function DELETE(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { provider?: string };
  if (!body.provider) {
    return NextResponse.json(
      { error: "provider is required" },
      { status: 400 }
    );
  }

  await db
    .delete(userIntegrations)
    .where(
      and(
        eq(userIntegrations.clerkUserId, userId),
        eq(userIntegrations.provider, body.provider)
      )
    );

  return NextResponse.json({ status: "disconnected" });
}
