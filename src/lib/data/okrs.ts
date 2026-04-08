import { db } from "@/lib/db";
import { okrUpdates, squads } from "@/lib/db/schema";
import { desc, eq, gte } from "drizzle-orm";

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

export interface OkrUpdateRow {
  pillar: string | null;
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

export function groupLatestOkrRows(rows: OkrUpdateRow[]): Map<string, OkrSummary[]> {
  const latestTsPerSquad = new Map<string, string>();
  const deduped: OkrSummary[] = [];

  for (const row of rows) {
    const squad = row.squadName;
    const existing = latestTsPerSquad.get(squad);

    if (!existing) {
      latestTsPerSquad.set(squad, row.slackTs);
    } else if (row.slackTs !== existing) {
      continue;
    }

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

  const grouped = new Map<string, OkrSummary[]>();
  for (const okr of deduped) {
    const existing = grouped.get(okr.pillar) ?? [];
    existing.push(okr);
    grouped.set(okr.pillar, existing);
  }

  return grouped;
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

  return groupLatestOkrRows(rows);
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

export interface SquadInfo {
  name: string;
  pillar: string;
  pmName: string | null;
  hasRecentUpdate: boolean;
}

/**
 * Get all active squads with whether they have a recent update (last 7 days).
 */
export async function getSquadsWithCoverage(): Promise<
  Map<string, SquadInfo[]>
> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const allSquads = await db
    .select()
    .from(squads)
    .where(eq(squads.isActive, true));

  // Get squads that have recent updates
  const recentUpdates = await db
    .select({ squadName: okrUpdates.squadName })
    .from(okrUpdates)
    .where(gte(okrUpdates.postedAt, sevenDaysAgo));

  const recentSquadNames = new Set(recentUpdates.map((r) => r.squadName));

  const grouped = new Map<string, SquadInfo[]>();
  for (const squad of allSquads) {
    const existing = grouped.get(squad.pillar) ?? [];
    existing.push({
      name: squad.name,
      pillar: squad.pillar,
      pmName: squad.pmName,
      hasRecentUpdate: recentSquadNames.has(squad.name),
    });
    grouped.set(squad.pillar, existing);
  }

  return grouped;
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
