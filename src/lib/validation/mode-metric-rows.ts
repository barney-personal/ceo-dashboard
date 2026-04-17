import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { summarizeZodIssues } from "./llm-output";

/**
 * Row-level zod schemas for the unit-economics KPI queries in `metrics.ts`.
 * Values are nullable — Mode frequently returns `null` for sparse metrics,
 * but must be `number | null`, never strings or other types. If Mode's
 * schema drifts (e.g. cents returned as "$1.23" strings), `validateMetricRow`
 * emits a Sentry warning tagged `validation_failure` and returns `null` so
 * the rest of the loader falls through to its existing fallback.
 */

const numericNullable = z.number().finite().nullable().optional();

export const ltvRowSchema = z
  .object({ user_pnl_36m: numericNullable })
  .passthrough();

export const arpuRowSchema = z
  .object({
    arpmau: numericNullable,
    gross_margin: numericNullable,
    contribution_margin: numericNullable,
    mau: numericNullable,
    monthly_revenue: numericNullable,
  })
  .passthrough();

export const cpaRowSchema = z
  .object({ avg_cpa: numericNullable })
  .passthrough();

export const cvrRowSchema = z
  .object({ average_7d_plus_m11_cvr: numericNullable })
  .passthrough();

export type LtvRow = z.infer<typeof ltvRowSchema>;
export type ArpuRow = z.infer<typeof arpuRowSchema>;
export type CpaRow = z.infer<typeof cpaRowSchema>;
export type CvrRow = z.infer<typeof cvrRowSchema>;

/**
 * Validate a single Mode row against a schema. On failure, emit one Sentry
 * warning tagged with the report/query name and return `null`. Callers fall
 * back to their existing null-handling path.
 */
export function validateMetricRow<T>(
  schema: z.ZodType<T>,
  row: Record<string, unknown>,
  context: { reportName?: string; queryName: string }
): T | null {
  const result = schema.safeParse(row);
  if (result.success) return result.data;

  Sentry.captureMessage("Mode metric row validation failure", {
    level: "warning",
    tags: {
      data_loader: "mode",
      validation_failure: "true",
      ...(context.reportName ? { reportName: context.reportName } : {}),
      queryName: context.queryName,
    },
    extra: {
      reportName: context.reportName ?? null,
      queryName: context.queryName,
      invalidFieldNames: Object.keys(row),
      issues: summarizeZodIssues(result.error),
    },
  });
  return null;
}
