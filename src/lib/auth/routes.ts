/** Route patterns that do not require proxy-level authentication */
export const PUBLIC_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/access-denied$/,
];

/** API routes handle their own auth (cron secret, Clerk currentUser, etc.) */
export const API_ROUTE_PATTERN = /^\/api\//;

/** Check if a pathname is a public (unauthenticated) route */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** Check if a pathname is an API route (auth handled by the route itself) */
export function isApiPath(pathname: string): boolean {
  return API_ROUTE_PATTERN.test(pathname);
}
