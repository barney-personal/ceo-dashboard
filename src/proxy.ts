import { clerkMiddleware, createRouteMatcher, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getUserRole } from "@/lib/auth/roles";

const ALLOWED_DOMAIN = "meetcleo.com";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/access-denied"]);
const isApiRoute = createRouteMatcher(["/api/(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  // API routes handle their own auth (cron secret, Clerk currentUser, etc.)
  if (isApiRoute(request)) return;

  if (!isPublicRoute(request)) {
    const { userId } = await auth.protect();

    // Verify email domain
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    )?.emailAddress;

    if (!email || !email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      return NextResponse.redirect(new URL("/access-denied", request.url));
    }

    // Auth and domain validation passed — attach user context to Sentry scope.
    const role = getUserRole(user.publicMetadata as Record<string, unknown>);
    Sentry.setUser({ id: userId, email, role });
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
