import { db } from "@/lib/db";
import { okrUpdates } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export interface OkrSummary {
  pillar: string;
  squadName: string;
  objectiveName: string;
  krName: string;
  status: string;
  actual: string | null;
  target: string | null;
  userName: string | null;
  postedAt: Date;
  channelId: string;
  slackTs: string;
}

/**
 * Get the latest OKR updates grouped by pillar.
 * Returns only the most recent update per KR (deduped by squad + KR name).
 */
export async function getLatestOkrUpdates(): Promise<
  Map<string, OkrSummary[]>
> {
  const rows = await db
    .select()
    .from(okrUpdates)
    .orderBy(desc(okrUpdates.postedAt));

  // Dedupe: keep only the latest update per (squadName + krName)
  const seen = new Set<string>();
  const deduped: OkrSummary[] = [];

  for (const row of rows) {
    const key = `${row.squadName}::${row.krName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push({
      pillar: row.pillar ?? "Other",
      squadName: row.squadName,
      objectiveName: row.objectiveName,
      krName: row.krName,
      status: row.status,
      actual: row.actual,
      target: row.target,
      userName: row.userName,
      postedAt: row.postedAt,
      channelId: row.channelId,
      slackTs: row.slackTs,
    });
  }

  // Group by pillar
  const grouped = new Map<string, OkrSummary[]>();
  for (const okr of deduped) {
    const existing = grouped.get(okr.pillar) ?? [];
    existing.push(okr);
    grouped.set(okr.pillar, existing);
  }

  return grouped;
}

/**
 * Get OKR status counts for the overview.
 */
export async function getOkrStatusCounts(): Promise<{
  onTrack: number;
  atRisk: number;
  behind: number;
  total: number;
}> {
  const updates = await getLatestOkrUpdates();
  const all = [...updates.values()].flat();

  return {
    onTrack: all.filter((o) => o.status === "on_track").length,
    atRisk: all.filter((o) => o.status === "at_risk").length,
    behind: all.filter((o) => o.status === "behind").length,
    total: all.length,
  };
}

/**
 * Build a Slack deep link to the original message.
 */
export function getSlackMessageUrl(
  channelId: string,
  ts: string
): string {
  const cleanTs = ts.replace(".", "");
  return `https://cleo-team.slack.com/archives/${channelId}/p${cleanTs}`;
}
