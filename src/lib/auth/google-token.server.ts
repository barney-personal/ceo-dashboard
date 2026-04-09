import { clerkClient } from "@clerk/nextjs/server";

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
    const response = await client.users.getUserOauthAccessToken(
      userId,
      "google"
    );

    const token = response.data[0];
    if (!token?.token) return null;

    return token.token;
  } catch {
    return null;
  }
}
