import { currentUser } from "@clerk/nextjs/server";

export const CURRENT_USER_TIMEOUT_MS = 5000;

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

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
