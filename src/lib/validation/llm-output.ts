import { z } from "zod";

/**
 * Zod schemas for LLM-generated payloads we deserialize at sync boundaries.
 *
 *  - `parsedOkrKrSchema` / `parsedOkrUpdateSchema` mirror the shape
 *    `llmParseOkrUpdate` expects from Claude.
 *  - `financialExtractSchema` mirrors the shape `parseManagementAccounts`
 *    expects from Claude for management-accounts Excel exports.
 *
 * Both schemas reject obviously wrong payloads cleanly; callers surface
 * failures via Sentry with `tag: llm_parse_invalid` and return `null` so
 * the sync run continues rather than crashing.
 */

const ragSchema = z.enum(["green", "amber", "red", "not_started"]);

export const parsedOkrKrSchema = z
  .object({
    objective: z.string().trim().min(1),
    name: z.string().trim().min(1),
    rag: ragSchema,
    metric: z.string().nullable().optional(),
  })
  .passthrough();

export const parsedOkrUpdateSchema = z
  .object({
    squadName: z.string().trim().min(1),
    tldr: z.string().optional(),
    krs: z.array(z.unknown()),
  })
  .passthrough();

export type ParsedOkrKrInput = z.infer<typeof parsedOkrKrSchema>;
export type ParsedOkrEnvelopeInput = z.infer<typeof parsedOkrUpdateSchema>;

// Gross / contribution margins are revenue-proportional ratios — always in
// [-1, 1] by construction, so a value outside that range is almost certainly
// an extraction error.
const boundedMarginSchema = z.number().finite().min(-1).max(1).nullable();

// EBITDA margin (and similar P&L-as-%-of-revenue ratios) can legitimately
// exceed ±100% for burn-stage startups — e.g. £1M revenue / £3M EBITDA burn
// is -300%. Only require finiteness.
const unboundedMarginSchema = z.number().finite().nullable();

const financialNumberSchema = z.number().finite().nullable();

export const financialExtractSchema = z
  .object({
    period: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "period must match YYYY-MM"),
    periodLabel: z.string().default(""),
    revenue: financialNumberSchema.default(null),
    grossProfit: financialNumberSchema.default(null),
    grossMargin: boundedMarginSchema.default(null),
    contributionProfit: financialNumberSchema.default(null),
    contributionMargin: boundedMarginSchema.default(null),
    ebitda: financialNumberSchema.default(null),
    ebitdaMargin: unboundedMarginSchema.default(null),
    netIncome: financialNumberSchema.default(null),
    cashPosition: financialNumberSchema.default(null),
    cashBurn: financialNumberSchema.default(null),
    opex: financialNumberSchema.default(null),
    headcountCost: financialNumberSchema.default(null),
    marketingCost: financialNumberSchema.default(null),
  })
  .passthrough();

export type FinancialExtractInput = z.infer<typeof financialExtractSchema>;

export function summarizeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}
