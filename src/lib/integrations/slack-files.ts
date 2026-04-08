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

const MGMT_ACCOUNTS_CHANNEL = "C036J68MTJ5"; // #fyi-management_accounts

/**
 * List management accounts xlsx files, sorted newest first.
 */
export async function getManagementAccountFiles(): Promise<SlackFile[]> {
  const files = await listChannelFiles(MGMT_ACCOUNTS_CHANNEL, {
    types: "all",
    count: 20,
  });
  return files
    .filter(
      (f) =>
        f.name.toLowerCase().includes("management accounts") &&
        f.filetype === "xlsx"
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

interface FilesListResponse {
  ok: boolean;
  error?: string;
  files: SlackFile[];
  paging: { pages: number; page: number };
}

/**
 * List files in a channel, optionally filtered by type.
 */
export async function listChannelFiles(
  channelId: string,
  options?: { types?: string; oldest?: number; count?: number }
): Promise<SlackFile[]> {
  const params = new URLSearchParams({
    channel: channelId,
    count: String(options?.count ?? 20),
  });
  if (options?.types) params.set("types", options.types);
  if (options?.oldest) params.set("ts_from", String(options.oldest));

  const data = await slackApiRequest<FilesListResponse>("files.list", Object.fromEntries(params));
  return data.files;
}

/**
 * Get file info including download URL.
 */
export async function getFileInfo(fileId: string): Promise<SlackFile> {
  const data = await slackApiRequest<{
    ok: boolean;
    error?: string;
    file: SlackFile;
  }>("files.info", { file: fileId });
  return data.file;
}

/**
 * Download a Slack file by its private download URL.
 * Returns the raw file buffer.
 */
export async function downloadSlackFile(
  urlPrivateDownload: string
): Promise<Buffer> {
  const res = await slackDownloadRequest(urlPrivateDownload);

  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
