/**
 * Dev-only escape hatch that lets unauthenticated requests through Clerk
 * middleware and back-fills `currentUser()` with a real Clerk user looked up
 * by email. Lets local dev tools (Claude Preview, curl, etc.) inspect
 * authed pages without going through the SSO flow.
 *
 * Triple-gated:
 *   1. `NODE_ENV !== "production"`
 *   2. `DEV_PREVIEW_USER_EMAIL` env var must be set
 *   3. The email must resolve to a real Clerk user (failure falls back to
 *      the unauth path — no mock user is fabricated)
 *
 * Render sets `NODE_ENV=production` in render.yaml, and Doppler `prd` does
 * not (and must not) set `DEV_PREVIEW_USER_EMAIL`, so this cannot activate
 * in production.
 */
export function getDevPreviewUserEmail(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const email = process.env.DEV_PREVIEW_USER_EMAIL?.trim();
  return email && email.length > 0 ? email : null;
}

export function isDevPreviewEnabled(): boolean {
  return getDevPreviewUserEmail() !== null;
}
