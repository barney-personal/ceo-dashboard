import { cache } from "react";
import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { getDevPreviewUserEmail } from "./dev-preview";

export const CURRENT_USER_TIMEOUT_MS = 5000;

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const getDevPreviewUser = cache(async (): Promise<ClerkUser | null> => {
  const email = getDevPreviewUserEmail();
  if (!email) return null;
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ emailAddress: [email] });
    return list.data[0] ?? null;
  } catch {
    return null;
  }
});

export type CurrentUserLookupResult =
  | { status: "authenticated"; user: ClerkUser }
  | { status: "unauthenticated"; user: null }
  | { status: "timeout"; user: null };

class CurrentUserTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Clerk currentUser() timed out after ${timeoutMs}ms`);
    this.name = "CurrentUserTimeoutError";
  }
}

export async function getCurrentUserWithTimeout({
  timeoutMs = CURRENT_USER_TIMEOUT_MS,
}: {
  timeoutMs?: number;
} = {}): Promise<CurrentUserLookupResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const user = await Promise.race([
      currentUser(),
      new Promise<null>((_, reject) => {
        timer = setTimeout(
          () => reject(new CurrentUserTimeoutError(timeoutMs)),
          timeoutMs
        );
      }),
    ]);

    if (!user) {
      const previewUser = await getDevPreviewUser();
      if (previewUser) {
        return { status: "authenticated", user: previewUser };
      }
      return { status: "unauthenticated", user: null };
    }

    return { status: "authenticated", user };
  } catch (error) {
    if (error instanceof CurrentUserTimeoutError) {
      return { status: "timeout", user: null };
    }

    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
