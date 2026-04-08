export const SLACK_WORKSPACE_URL = "https://cleo-team.slack.com";

export function buildSlackMessageUrl(channelId: string, ts: string): string {
  return `${SLACK_WORKSPACE_URL}/archives/${channelId}/p${ts.replace(".", "")}`;
}
