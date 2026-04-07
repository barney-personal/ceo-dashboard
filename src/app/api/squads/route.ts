import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getUserRole, hasAccess } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function requireCeo() {
  const user = await currentUser();
  if (!user) return null;
  const role = getUserRole(
    (user.publicMetadata as Record<string, unknown>) ?? {}
  );
  return hasAccess(role, "ceo") ? user : null;
}

export async function GET() {
  const user = await requireCeo();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const all = await db.select().from(squads).orderBy(squads.pillar, squads.name);
  return NextResponse.json(all);
}

export async function POST(request: NextRequest) {
  const user = await requireCeo();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
}

export async function PUT(request: NextRequest) {
  const user = await requireCeo();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { id, name, pillar, pmName, channelId, dashboardUrl, isActive } = body;

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
      ...(dashboardUrl !== undefined && { dashboardUrl }),
      ...(isActive !== undefined && { isActive }),
      updatedAt: new Date(),
    })
    .where(eq(squads.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Squad not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
