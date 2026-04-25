import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import {
  requireRole,
  authErrorResponse,
} from "@/lib/sync/request-auth";
import { getImpersonation } from "@/lib/auth/roles.server";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  getUserGoogleAccessToken,
} from "@/lib/auth/google-token.server";

export const dynamic = "force-dynamic";

/**
 * CEO-only debug endpoint: dumps everything the Overview page uses to decide
 * whether to show the "Reconnect Google Calendar" banner. Intended for
 * diagnosing situations where the banner fires despite a valid Clerk
 * connection — call it with the same session cookie and compare the
 * computed state against what Clerk actually holds.
 */
export async function GET() {
  const access = await requireRole("ceo");
  const err = authErrorResponse(access);
  if (err) return err;

  const [authState, impersonation] = await Promise.all([
    auth(),
    getImpersonation(),
  ]);
  const realUserId = authState.userId;
  const effectiveUserId = impersonation?.userId ?? realUserId;

  const client = await clerkClient();

  async function dumpClerkTokens(userId: string) {
    const result: Record<string, unknown> = { userId };
    for (const provider of ["google", "oauth_google"] as const) {
      try {
        // Call on client.users to preserve the SDK's `this` binding —
        // `getUserOauthAccessToken` calls `this.requireId(userId)` internally.
        const res = await client.users.getUserOauthAccessToken(
          userId,
          provider as "oauth_google",
        );
        const tokens = res.data ?? [];
        result[provider] = {
          count: tokens.length,
          entries: tokens.map((t) => ({
            hasToken: typeof t.token === "string" && t.token.length > 0,
            scopes: t.scopes ?? null,
            hasCalendarScope:
              Array.isArray(t.scopes) &&
              t.scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE),
            expiresAt: t.expiresAt ?? null,
            expiresInSec: t.expiresAt
              ? Math.round((t.expiresAt - Date.now()) / 1000)
              : null,
          })),
        };
      } catch (e) {
        result[provider] = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return result;
  }

  const realClerkTokens = realUserId ? await dumpClerkTokens(realUserId) : null;
  const impersonatedClerkTokens =
    impersonation?.userId && impersonation.userId !== realUserId
      ? await dumpClerkTokens(impersonation.userId)
      : null;

  const accessToken = realUserId
    ? await getUserGoogleAccessToken(realUserId)
    : null;

  let calendarProbe: unknown = { skipped: true, reason: "no access token" };
  if (accessToken) {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set("timeMin", todayStart.toISOString());
    url.searchParams.set("timeMax", todayEnd.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "50");

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = res.ok ? await res.json() : await res.text();
      if (res.ok && typeof body === "object" && body && "items" in body) {
        const items = (body as { items: Array<{ attendees?: unknown[]; summary?: string; status?: string }> }).items ?? [];
        calendarProbe = {
          status: res.status,
          itemCount: items.length,
          passAttendeeFilter: items.filter(
            (e) =>
              e.status !== "cancelled" &&
              Array.isArray(e.attendees) &&
              e.attendees.length >= 2,
          ).length,
          sample: items
            .slice(0, 3)
            .map((e) => ({ summary: e.summary, status: e.status })),
        };
      } else {
        calendarProbe = {
          status: res.status,
          body: typeof body === "string" ? body.slice(0, 500) : body,
        };
      }
    } catch (e) {
      calendarProbe = {
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return NextResponse.json(
    {
      realUserId,
      effectiveUserId,
      impersonation: impersonation
        ? {
            userId: impersonation.userId,
            name: impersonation.name,
            role: impersonation.role,
          }
        : null,
      realClerkTokens,
      impersonatedClerkTokens,
      overviewAccessTokenResolvedFrom: "realUserId",
      accessTokenReturned: !!accessToken,
      calendarProbe,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
