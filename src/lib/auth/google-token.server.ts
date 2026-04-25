import { clerkClient } from "@clerk/nextjs/server";

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

const GOOGLE_OAUTH_PROVIDERS = ["google", "oauth_google"] as const;

interface ClerkOauthAccessToken {
  token?: string | null;
  scopes?: string[] | null;
  expiresAt?: number | null;
}

function hasCalendarScope(token: ClerkOauthAccessToken): boolean {
  return Array.isArray(token.scopes)
    ? token.scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE)
    : false;
}

function pickBestGoogleToken(
  tokens: ClerkOauthAccessToken[]
): string | null {
  const usableTokens = tokens.filter(
    (token): token is ClerkOauthAccessToken & { token: string } =>
      typeof token.token === "string" && token.token.length > 0
  );
  if (usableTokens.length === 0) return null;

  const calendarScopedTokens = usableTokens
    .filter(hasCalendarScope)
    .sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0));
  if (calendarScopedTokens[0]) return calendarScopedTokens[0].token;

  const freshestToken = [...usableTokens].sort(
    (a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0)
  )[0];
  return freshestToken?.token ?? null;
}

/**
 * Get a Google OAuth access token for a specific user via Clerk.
 * Returns the token string, or null if the user hasn't connected Google
 * or hasn't granted calendar scope.
 *
 * Server-only: uses Clerk backend SDK.
 */
export async function getUserGoogleAccessToken(
  userId: string
): Promise<string | null> {
  try {
    const client = await clerkClient();
    const probeErrors: Record<string, string> = {};
    let sawAnyToken = false;
    let sawAnyScoped = false;

    for (const provider of GOOGLE_OAUTH_PROVIDERS) {
      try {
        // Clerk's SDK method relies on its `this` binding (it calls
        // `this.requireId(userId)` internally). We must call it on
        // `client.users` rather than via a detached method reference.
        // The published provider id is now "google" but the SDK overload
        // only types "oauth_google"; the runtime accepts either, so we
        // cast the provider string for TypeScript without rebinding.
        const response = await client.users.getUserOauthAccessToken(
          userId,
          provider as "oauth_google",
        );
        const tokens = (response.data ?? []) as ClerkOauthAccessToken[];
        if (tokens.length > 0) sawAnyToken = true;
        if (tokens.some(hasCalendarScope)) sawAnyScoped = true;
        const token = pickBestGoogleToken(tokens);
        if (token) return token;
      } catch (err) {
        probeErrors[provider] =
          err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    // Only warn when the null return is actionable: Clerk returned tokens
    // that we couldn't use, or the probe itself errored. Users who simply
    // haven't connected Google ("no tokens at all, no errors") are the
    // boring case and don't need to spam logs on every overview load.
    const hasProbeErrors = Object.keys(probeErrors).length > 0;
    if (sawAnyToken || hasProbeErrors) {
      console.warn("[google-token] returning null for user", {
        userId,
        sawAnyToken,
        sawAnyScoped,
        probeErrors,
      });
    }
    return null;
  } catch (err) {
    console.warn("[google-token] clerkClient() threw, returning null", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
