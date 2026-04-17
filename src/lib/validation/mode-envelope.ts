import { z } from "zod";

/**
 * Zod schemas for the top-level envelopes returned by Mode's HAL API
 * endpoints used in `src/lib/integrations/mode.ts`. Each response nests
 * the interesting array under `_embedded`; these schemas fail loudly when
 * Mode changes that shape so we can surface a typed error with a distinct
 * Sentry tag (`mode_envelope_invalid`) instead of an opaque property-access
 * crash deeper in the code.
 *
 * Only the fields the loaders actually read are enforced; extras pass
 * through via `.passthrough()`.
 */

const modeRunSchema = z
  .object({
    token: z.string().min(1),
    state: z.string().min(1),
    created_at: z.string().min(1),
  })
  .passthrough();

const modeQueryLinksSchema = z
  .object({
    query: z.object({ href: z.string().min(1) }).passthrough(),
    result: z.object({ href: z.string().min(1) }).passthrough(),
  })
  .passthrough();

const modeQueryRunSchema = z
  .object({
    token: z.string().min(1),
    state: z.string().min(1),
    _links: modeQueryLinksSchema,
  })
  .passthrough();

const modeQuerySchema = z
  .object({
    token: z.string().min(1),
    name: z.string(),
  })
  .passthrough();

export const modeReportRunsEnvelopeSchema = z
  .object({
    _embedded: z.object({
      report_runs: z.array(modeRunSchema),
    }),
  })
  .passthrough();

export const modeQueryRunsEnvelopeSchema = z
  .object({
    _embedded: z.object({
      query_runs: z.array(modeQueryRunSchema),
    }),
  })
  .passthrough();

export const modeQueriesEnvelopeSchema = z
  .object({
    _embedded: z.object({
      queries: z.array(modeQuerySchema),
    }),
  })
  .passthrough();

export type ModeReportRunsEnvelope = z.infer<typeof modeReportRunsEnvelopeSchema>;
export type ModeQueryRunsEnvelope = z.infer<typeof modeQueryRunsEnvelopeSchema>;
export type ModeQueriesEnvelope = z.infer<typeof modeQueriesEnvelopeSchema>;

export class ModeEnvelopeValidationError extends Error {
  readonly envelope: string;
  readonly issues: string;

  constructor(envelope: string, issues: string) {
    super(`Mode ${envelope} envelope failed validation: ${issues}`);
    this.name = "ModeEnvelopeValidationError";
    this.envelope = envelope;
    this.issues = issues;
  }
}
