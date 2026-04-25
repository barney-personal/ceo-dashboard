const SCHEMA_ERROR_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42704", // undefined_object
]);

const UNIQUE_VIOLATION_CODE = "23505";

const DATABASE_UNAVAILABLE_CODES = new Set([
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "57014", // statement timeout / cancellation
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

const SCHEMA_ERROR_PATTERNS = [
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /table .* does not exist/i,
  /undefined column/i,
  /undefined table/i,
] as const;

const DATABASE_UNAVAILABLE_PATTERNS = [
  /statement timeout/i,
  /canceling statement due to user request/i,
  /connection terminated unexpectedly/i,
  /connection.*closed/i,
  /connection.*ended/i,
  /fetch failed/i,
  /connect timeout/i,
  /timed out/i,
  /could not connect/i,
  /connection refused/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /the database system is starting up/i,
  /econnrefused/i,
  /econnreset/i,
  /eai_again/i,
  /enotfound/i,
] as const;

export class DatabaseUnavailableError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

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

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!("code" in error) || typeof error.code !== "string") {
    return false;
  }

  return error.code === UNIQUE_VIOLATION_CODE;
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof DatabaseUnavailableError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);

  if (code && DATABASE_UNAVAILABLE_CODES.has(code)) {
    return true;
  }

  return DATABASE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function getDatabaseUnavailableMessage(
  context: string,
  error: unknown
): string {
  const prefix = `${context} could not reach Postgres or complete the query in time.`;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return `${prefix} ${error.message}`;
  }

  return prefix;
}

export function normalizeDatabaseError(
  context: string,
  error: unknown
): Error {
  if (isSchemaCompatibilityError(error)) {
    return new Error(getSchemaCompatibilityMessage(error));
  }

  if (isDatabaseUnavailableError(error)) {
    return new DatabaseUnavailableError(
      getDatabaseUnavailableMessage(context, error),
      error
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Wrap a DB-reading loader so any Postgres failure surfaces as a typed
 * error (DatabaseUnavailableError or a schema-compatibility Error) rather
 * than a raw pg error. Already-normalized errors pass through unchanged
 * so nested loaders don't double-wrap.
 */
export async function withDbErrorContext<T>(
  context: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      throw error;
    }
    throw normalizeDatabaseError(context, error);
  }
}
