const SLACK_API = "https://slack.com/api";

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");
  return token;
}

export interface SlackFile {
  id: string;
  name: string;
  filetype: string;
  size: number;
  url_private_download: string;
  timestamp: number;
  user: string;
  channels: string[];
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

  const res = await fetch(`${SLACK_API}/files.list?${params}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = (await res.json()) as FilesListResponse;
  if (!data.ok) {
    throw new Error(`Slack files.list error: ${data.error}`);
  }

  return data.files;
}

/**
 * Get file info including download URL.
 */
export async function getFileInfo(fileId: string): Promise<SlackFile> {
  const res = await fetch(`${SLACK_API}/files.info?file=${fileId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  const data = (await res.json()) as { ok: boolean; error?: string; file: SlackFile };
  if (!data.ok) {
    throw new Error(`Slack files.info error: ${data.error}`);
  }

  return data.file;
}

/**
 * Download a Slack file by its private download URL.
 * Returns the raw file buffer.
 */
export async function downloadSlackFile(
  urlPrivateDownload: string
): Promise<Buffer> {
  const res = await fetch(urlPrivateDownload, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
