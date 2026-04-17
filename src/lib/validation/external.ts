import { z, type ZodType } from "zod";

export type ValidationSource = "mode" | "anthropic" | "slack";

type ValidationContext = {
  source: ValidationSource;
  boundary: string;
  payload?: unknown;
};

function getIssuePaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.path[0]).filter((path): path is string => typeof path === "string"))];
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

export function toPayloadPreview(value: unknown, maxLength = 200): string {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

export class ExternalValidationError extends Error {
  readonly source: ValidationSource;
  readonly boundary: string;
  readonly issues: string[];
  readonly issuePaths: string[];
  readonly payloadPreview: string;

  constructor(
    message: string,
    input: {
      source: ValidationSource;
      boundary: string;
      issues: string[];
      issuePaths: string[];
      payloadPreview: string;
      cause?: unknown;
    }
  ) {
    super(message, input.cause ? { cause: input.cause } : undefined);
    this.name = "ExternalValidationError";
    this.source = input.source;
    this.boundary = input.boundary;
    this.issues = input.issues;
    this.issuePaths = input.issuePaths;
    this.payloadPreview = input.payloadPreview;
  }
}

export function isExternalValidationError(
  error: unknown
): error is ExternalValidationError {
  return error instanceof ExternalValidationError;
}

export function parseWithSchema<T>(
  schema: ZodType<T>,
  value: unknown,
  context: ValidationContext
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const issues = formatZodIssues(result.error);
  throw new ExternalValidationError(
    `${context.source} returned malformed ${context.boundary}: ${issues[0] ?? "invalid payload"}`,
    {
      source: context.source,
      boundary: context.boundary,
      issues,
      issuePaths: getIssuePaths(result.error),
      payloadPreview: toPayloadPreview(context.payload ?? value),
      cause: result.error,
    }
  );
}

export function safeParseWithSchema<T>(
  schema: ZodType<T>,
  value: unknown,
  context: ValidationContext
):
  | { success: true; data: T }
  | { success: false; error: ExternalValidationError } {
  try {
    return {
      success: true,
      data: parseWithSchema(schema, value, context),
    };
  } catch (error) {
    if (isExternalValidationError(error)) {
      return { success: false, error };
    }

    throw error;
  }
}
