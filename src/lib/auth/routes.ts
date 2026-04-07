/** Route patterns that do not require authentication */
export const PUBLIC_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
];

/** Check if a pathname is a public (unauthenticated) route */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}
