import { z } from "zod";

/**
 * Zod schemas for the Slack Web API response envelopes we deserialize at
 * sync boundaries. Only the fields the loaders actually read are enforced;
 * extras pass through via `.passthrough()` so future additions don't break
 * the pipeline.
 *
 * Validation failures are surfaced as `SlackEnvelopeValidationError` with
 * a distinct Sentry tag (`slack_envelope_invalid`) so schema drift shows
 * up as an observable signal rather than an opaque property-access crash
 * deeper in sync code.
 */

const slackMessageSchema = z
  .object({
    ts: z.string().min(1),
    user: z.string().optional(),
    text: z.string(),
    type: z.string().min(1),
    subtype: z.string().optional(),
    thread_ts: z.string().optional(),
    reply_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const slackFileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    filetype: z.string(),
    size: z.number().int().nonnegative(),
    url_private_download: z.string(),
    permalink: z.string(),
    permalink_public: z.string().optional(),
    timestamp: z.number(),
    user: z.string(),
    channels: z.array(z.string()),
  })
  .passthrough();

export const conversationsHistoryEnvelopeSchema = z
  .object({
    messages: z.array(slackMessageSchema),
    has_more: z.boolean().optional(),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const conversationsInfoEnvelopeSchema = z
  .object({
    channel: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export const usersInfoEnvelopeSchema = z
  .object({
    user: z
      .object({
        real_name: z.string().optional(),
        profile: z
          .object({ display_name: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const filesListEnvelopeSchema = z
  .object({
    files: z.array(slackFileSchema),
    paging: z
      .object({
        pages: z.number().int().nonnegative().optional(),
        page: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const filesInfoEnvelopeSchema = z
  .object({ file: slackFileSchema })
  .passthrough();

export type ConversationsHistoryEnvelope = z.infer<
  typeof conversationsHistoryEnvelopeSchema
>;
export type ConversationsInfoEnvelope = z.infer<
  typeof conversationsInfoEnvelopeSchema
>;
export type UsersInfoEnvelope = z.infer<typeof usersInfoEnvelopeSchema>;
export type FilesListEnvelope = z.infer<typeof filesListEnvelopeSchema>;
export type FilesInfoEnvelope = z.infer<typeof filesInfoEnvelopeSchema>;

export class SlackEnvelopeValidationError extends Error {
  readonly method: string;
  readonly issues: string;

  constructor(method: string, issues: string) {
    super(`Slack ${method} envelope failed validation: ${issues}`);
    this.name = "SlackEnvelopeValidationError";
    this.method = method;
    this.issues = issues;
  }
}
