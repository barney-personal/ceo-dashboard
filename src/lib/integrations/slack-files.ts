import {
  slackApiRequest,
  slackDownloadRequest,
  validateSlackEnvelope,
} from "./slack";
import {
  filesInfoEnvelopeSchema,
  filesListEnvelopeSchema,
  type FilesInfoEnvelope,
  type FilesListEnvelope,
} from "@/lib/validation/slack-envelope";

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
  const data: FilesListEnvelope = validateSlackEnvelope(
    "files.list",
    filesListEnvelopeSchema,
    raw,
  );
  return data.files as SlackFile[];
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
    { signal: opts.signal },
  );
  const data: FilesInfoEnvelope = validateSlackEnvelope(
    "files.info",
    filesInfoEnvelopeSchema,
    raw,
  );
  return data.file as SlackFile;
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
