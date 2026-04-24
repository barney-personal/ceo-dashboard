import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  EngineeringViewMutationError,
  getEngineeringViewResolution,
  setEngineeringViewB,
} from "@/lib/auth/engineering-view.server";

interface PostBody {
  engineeringViewB?: unknown;
}

export async function GET() {
  try {
    const resolution = await getEngineeringViewResolution();
    return NextResponse.json({
      surface: resolution.surface,
      actualCeo: resolution.actualCeo,
      toggleOn: resolution.toggleOn,
    });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBody;
    if (typeof body.engineeringViewB !== "boolean") {
      return NextResponse.json(
        { error: "engineeringViewB must be a boolean" },
        { status: 400 },
      );
    }

    await setEngineeringViewB(body.engineeringViewB);

    const resolution = await getEngineeringViewResolution();
    return NextResponse.json({
      surface: resolution.surface,
      actualCeo: resolution.actualCeo,
      toggleOn: resolution.toggleOn,
    });
  } catch (error) {
    if (error instanceof EngineeringViewMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
