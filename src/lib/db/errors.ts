const SCHEMA_ERROR_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42704", // undefined_object
]);

const SCHEMA_ERROR_PATTERNS = [
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /table .* does not exist/i,
  /undefined column/i,
  /undefined table/i,
] as const;

export function isSchemaCompatibilityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  if (code && SCHEMA_ERROR_CODES.has(code)) {
    return true;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);

  return SCHEMA_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function getSchemaCompatibilityMessage(error: unknown): string {
  const suffix =
    "The database schema looks behind the deployed code. Wait for the Render migration to finish, then reload.";

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return `${error.message} ${suffix}`;
  }

  return suffix;
}
