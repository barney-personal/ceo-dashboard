import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { db } from "@/lib/db";
import { githubEmployeeMap } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface PutBody {
  login?: unknown;
  employeeEmail?: unknown;
  employeeName?: unknown;
}

/**
 * Update the employee an engineer's GitHub login is mapped to.
 *
 * Used by the "Edit mapping" UI on the engineer profile page when an engineer
 * has been auto-matched to the wrong person (or not matched at all).
 *
 * Pass `employeeEmail: null` to clear an existing mapping.
 */
export async function PUT(request: NextRequest) {
  try {
    const authError = await dashboardPermissionErrorResponse("admin.githubMapping");
    if (authError) return authError;

    const body = (await request.json()) as PutBody;
    const login = typeof body.login === "string" ? body.login.trim() : "";
    if (!login) {
      return NextResponse.json(
        { error: "login is required" },
        { status: 400 }
      );
    }

    const hasEmailKey = Object.prototype.hasOwnProperty.call(
      body,
      "employeeEmail"
    );
    if (!hasEmailKey) {
      return NextResponse.json(
        { error: "employeeEmail is required (pass null to clear)" },
        { status: 400 }
      );
    }

    const rawEmail = body.employeeEmail;
    const employeeEmail =
      rawEmail === null || rawEmail === ""
        ? null
        : typeof rawEmail === "string"
          ? rawEmail.trim().toLowerCase()
          : undefined;

    if (employeeEmail === undefined) {
      return NextResponse.json(
        { error: "employeeEmail must be a string or null" },
        { status: 400 }
      );
    }

    const rawName = body.employeeName;
    const employeeName =
      rawName === null || rawName === undefined || rawName === ""
        ? null
        : typeof rawName === "string"
          ? rawName.trim()
          : undefined;

    if (employeeName === undefined) {
      return NextResponse.json(
        { error: "employeeName must be a string or null" },
        { status: 400 }
      );
    }

    // Upsert into github_employee_map. Manual edits always overwrite any
    // auto/llm match — a CEO saying "this is wrong" is always the source of
    // truth.
    const values = {
      githubLogin: login,
      employeeEmail,
      employeeName,
      matchMethod: "manual",
      matchConfidence: employeeEmail ? "high" : null,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(githubEmployeeMap)
      .values(values)
      .onConflictDoUpdate({
        target: githubEmployeeMap.githubLogin,
        set: {
          employeeEmail: values.employeeEmail,
          employeeName: values.employeeName,
          matchMethod: values.matchMethod,
          matchConfidence: values.matchConfidence,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    // Verify we actually wrote the row (defensive — drizzle returns empty
    // array when there's nothing to return, which shouldn't happen here).
    if (!row) {
      const [existing] = await db
        .select()
        .from(githubEmployeeMap)
        .where(eq(githubEmployeeMap.githubLogin, login))
        .limit(1);
      if (!existing) {
        return NextResponse.json(
          { error: "Failed to update mapping" },
          { status: 500 }
        );
      }
      return NextResponse.json(existing);
    }

    return NextResponse.json(row);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
