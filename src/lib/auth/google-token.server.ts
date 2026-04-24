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

    for (const provider of GOOGLE_OAUTH_PROVIDERS) {
      try {
        const response = await getUserOauthAccessToken(userId, provider);
        const token = pickBestGoogleToken(
          response.data as ClerkOauthAccessToken[]
        );
        if (token) return token;
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}
