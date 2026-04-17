import * as Sentry from "@sentry/nextjs";
import { z, type ZodType } from "zod";
import {
  isExternalValidationError,
  parseWithSchema,
} from "@/lib/validation/external";
import {
  slackApiRequest,
  slackDownloadRequest,
} from "./slack";

export interface SlackFile {
  id: string;
  name: string;
  filetype: string;
  size: number;
  url_private_download: string;
  permalink: string;
  permalink_public?: string;
  timestamp: number;
  user: string;
  channels: string[];
}

const SlackFileSchema: ZodType<SlackFile> = z.object({
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
});

const FilesListResponseSchema = z.object({
  files: z.array(SlackFileSchema),
  paging: z
    .object({
      pages: z.number().int().nonnegative().optional(),
      page: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const FilesInfoResponseSchema = z.object({
  file: SlackFileSchema,
});

function parseSlackFilesResponse<T>(
  method: string,
  boundary: string,
  schema: ZodType<T>,
  payload: unknown
): T {
  try {
    return parseWithSchema(schema, payload, {
      source: "slack",
      boundary,
      payload,
    });
  } catch (error) {
    if (isExternalValidationError(error)) {
      Sentry.captureException(error, {
        tags: {
          integration: "slack",
          validation_boundary: error.boundary,
          validation_source: error.source,
        },
        extra: {
          method,
          issues: error.issues,
          payloadPreview: error.payloadPreview,
        },
      });
    }
    throw error;
  }
}

const MGMT_ACCOUNTS_CHANNEL = "C036J68MTJ5"; // #fyi-management_accounts

/**
 * List management accounts xlsx files, sorted newest first.
 */
export async function getManagementAccountFiles(
  opts: { signal?: AbortSignal } = {}
): Promise<SlackFile[]> {
  const files = await listChannelFiles(MGMT_ACCOUNTS_CHANNEL, {
    types: "all",
    count: 20,
  }, opts);
  return files
    .filter(
      (f) =>
        f.name.toLowerCase().includes("management accounts") &&
        f.filetype === "xlsx"
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * List files in a channel, optionally filtered by type.
 */
export async function listChannelFiles(
  channelId: string,
  options?: { types?: string; oldest?: number; count?: number },
  opts: { signal?: AbortSignal } = {}
): Promise<SlackFile[]> {
  const params = new URLSearchParams({
    channel: channelId,
    count: String(options?.count ?? 20),
  });
  if (options?.types) params.set("types", options.types);
  if (options?.oldest) params.set("ts_from", String(options.oldest));

  const raw = await slackApiRequest<unknown>(
    "files.list",
    Object.fromEntries(params),
    { signal: opts.signal }
  );
  const data = parseSlackFilesResponse(
    "files.list",
    "files_list_response",
    FilesListResponseSchema,
    raw
  );
  return data.files;
}

/**
 * Get file info including download URL.
 */
export async function getFileInfo(
  fileId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SlackFile> {
  const raw = await slackApiRequest<unknown>(
    "files.info",
    { file: fileId },
    { signal: opts.signal }
  );
  const data = parseSlackFilesResponse(
    "files.info",
    "files_info_response",
    FilesInfoResponseSchema,
    raw
  );
  return data.file;
}

/**
 * Download a Slack file by its private download URL.
 * Returns the raw file buffer.
 */
export async function downloadSlackFile(
  urlPrivateDownload: string,
  opts: { signal?: AbortSignal } = {}
): Promise<Buffer> {
  const res = await slackDownloadRequest(urlPrivateDownload, {
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
