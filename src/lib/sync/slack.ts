import { db } from "@/lib/db";
import { okrUpdates, syncLog } from "@/lib/db/schema";
import { getChannelHistory, getChannelName, getUserName } from "@/lib/integrations/slack";
import { parseOkrUpdate, isOkrUpdate } from "@/lib/integrations/slack-okr-parser";
import { eq, and, desc } from "drizzle-orm";

/** Map channel name to pillar for grouping */
function derivePillar(channelName: string): string {
  if (channelName.includes("growth")) return "Growth";
  if (channelName.includes("ewa") || channelName.includes("credit"))
    return "EWA & Credit Products";
  if (channelName.includes("new-bets")) return "New Bets";
  if (channelName.includes("chat")) return "Chat";
  if (channelName.includes("access") || channelName.includes("trust") || channelName.includes("risk"))
    return "Access, Trust & Money";
  if (channelName.includes("card")) return "Card";
  return "Other";
}

/**
 * Sync OKR updates from a single Slack channel.
 * Fetches messages since the last sync, parses OKR updates, upserts to DB.
 */
async function syncChannel(
  channelId: string,
  lastSyncTs?: string
): Promise<number> {
  const channelName = await getChannelName(channelId);
  const pillar = derivePillar(channelName);

  // Fetch messages since last sync (or last 30 days)
  const oldest =
    lastSyncTs ??
    String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  const messages = await getChannelHistory(channelId, oldest);

  let count = 0;

  for (const msg of messages) {
    if (!msg.text || msg.subtype || !isOkrUpdate(msg.text)) continue;

    const parsed = parseOkrUpdate(msg.text);
    if (!parsed) continue;

    const userName = msg.user ? await getUserName(msg.user) : null;
    const postedAt = new Date(parseFloat(msg.ts) * 1000);

    for (const objective of parsed.objectives) {
      for (const kr of objective.keyResults) {
        await db
          .insert(okrUpdates)
          .values({
            slackTs: msg.ts,
            channelId,
            channelName,
            userId: msg.user ?? null,
            userName,
            squadName: parsed.squadName,
            pillar,
            objectiveName: objective.name,
            krName: kr.name,
            status: kr.status,
            actual: kr.actual ?? null,
            target: kr.target ?? null,
            tldr: parsed.tldr ?? null,
            rawText: parsed.rawText.slice(0, 10000),
            postedAt,
          })
          .onConflictDoUpdate({
            target: [okrUpdates.slackTs, okrUpdates.channelId, okrUpdates.krName],
            set: {
              status: kr.status,
              actual: kr.actual ?? null,
              target: kr.target ?? null,
              tldr: parsed.tldr ?? null,
              syncedAt: new Date(),
            },
          });

        count++;
      }
    }
  }

  return count;
}

/**
 * Sync all configured OKR channels.
 */
export async function syncAllSlackOkrs(): Promise<{
  status: "success" | "error";
  recordsSynced: number;
  errors: string[];
}> {
  const channelIds = (process.env.SLACK_OKR_CHANNEL_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (channelIds.length === 0) {
    return { status: "success", recordsSynced: 0, errors: [] };
  }

  // Create sync log
  const [log] = await db
    .insert(syncLog)
    .values({ source: "slack" })
    .returning();

  try {
    // Get last successful slack sync time
    const lastSync = await db
      .select({ completedAt: syncLog.completedAt })
      .from(syncLog)
      .where(
        and(eq(syncLog.source, "slack"), eq(syncLog.status, "success"))
      )
      .orderBy(desc(syncLog.completedAt))
      .limit(1);

    const lastSyncTs = lastSync[0]?.completedAt
      ? String(lastSync[0].completedAt.getTime() / 1000)
      : undefined;

    let totalRecords = 0;
    const errors: string[] = [];

    for (const channelId of channelIds) {
      try {
        const count = await syncChannel(channelId, lastSyncTs);
        totalRecords += count;
      } catch (err) {
        const message = `Failed to sync channel ${channelId}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        console.error(message);
      }
    }

    const status = errors.length === 0 ? "success" : "error";

    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status,
        recordsSynced: totalRecords,
        errorMessage: errors.length > 0 ? errors.join("\n") : null,
      })
      .where(eq(syncLog.id, log.id));

    return { status, recordsSynced: totalRecords, errors };
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncLog.id, log.id));

    throw err;
  }
}
