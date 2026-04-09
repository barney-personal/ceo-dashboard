import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const all = await db.select().from(squads).orderBy(squads.pillar, squads.name);
    return NextResponse.json(all);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const body = await request.json();
    const { name, pillar, pmName, channelId } = body;

    if (!name || !pillar) {
      return NextResponse.json({ error: "name and pillar are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(squads)
      .values({ name, pillar, pmName: pmName ?? null, channelId: channelId ?? null })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireRole("ceo");
    const authError = authErrorResponse(auth);
    if (authError) {
      return authError;
    }

    const body = await request.json();
    const { id, name, pillar, pmName, channelId, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [updated] = await db
      .update(squads)
      .set({
        ...(name !== undefined && { name }),
        ...(pillar !== undefined && { pillar }),
        ...(pmName !== undefined && { pmName }),
        ...(channelId !== undefined && { channelId }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      })
      .where(eq(squads.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Squad not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
