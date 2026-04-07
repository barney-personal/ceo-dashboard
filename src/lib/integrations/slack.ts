const SLACK_API = "https://slack.com/api";

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");
  return token;
}

async function slackRequest<T>(
  method: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    throw new Error(`Slack API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  type: string;
  subtype?: string;
}

interface ConversationsHistoryResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
}

interface ConversationsInfoResponse {
  ok: boolean;
  channel: { name: string; id: string };
}

interface UsersInfoResponse {
  ok: boolean;
  user: { real_name: string; profile: { display_name: string } };
}

/**
 * Fetch message history from a channel.
 * Returns messages in chronological order (oldest first).
 */
export async function getChannelHistory(
  channelId: string,
  oldest?: string,
  limit = 100
): Promise<SlackMessage[]> {
  const params: Record<string, string> = {
    channel: channelId,
    limit: String(limit),
  };
  if (oldest) params.oldest = oldest;

  const data = await slackRequest<ConversationsHistoryResponse>(
    "conversations.history",
    params
  );

  // Slack returns newest first, reverse to chronological
  return data.messages.reverse();
}

/**
 * Get channel name by ID.
 */
export async function getChannelName(channelId: string): Promise<string> {
  const data = await slackRequest<ConversationsInfoResponse>(
    "conversations.info",
    { channel: channelId }
  );
  return data.channel.name;
}

/**
 * Get user display name by ID.
 */
const userNameCache = new Map<string, string>();

export async function getUserName(userId: string): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!;

  try {
    const data = await slackRequest<UsersInfoResponse>("users.info", {
      user: userId,
    });
    const name =
      data.user.profile.display_name || data.user.real_name || userId;
    userNameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}
