import { clerkClient } from "@clerk/nextjs/server";

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

const GOOGLE_OAUTH_PROVIDERS = ["google", "oauth_google"] as const;

interface ClerkOauthAccessToken {
  token?: string | null;
  scopes?: string[] | null;
  expiresAt?: number | null;
}

type GetUserOauthAccessTokenFn = (
  userId: string,
  provider: string
) => Promise<{ data: ClerkOauthAccessToken[] }>;

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
    // Clerk's published provider id is now `google`, but this SDK version's
    // overloads still only type-check the legacy `oauth_google` string.
    // Widen the call signature locally so we can probe both at runtime.
    const getUserOauthAccessToken =
      client.users.getUserOauthAccessToken as unknown as GetUserOauthAccessTokenFn;

    const probeErrors: Record<string, string> = {};
    let sawAnyToken = false;
    let sawAnyScoped = false;

    for (const provider of GOOGLE_OAUTH_PROVIDERS) {
      try {
        const response = await getUserOauthAccessToken(userId, provider);
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

    console.warn("[google-token] returning null for user", {
      userId,
      sawAnyToken,
      sawAnyScoped,
      probeErrors,
    });
    return null;
  } catch (err) {
    console.warn("[google-token] clerkClient() threw, returning null", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
