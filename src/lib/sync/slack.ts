import { db } from "@/lib/db";
import { okrUpdates, syncLog } from "@/lib/db/schema";
import { getChannelHistory, getChannelName, getUserName } from "@/lib/integrations/slack";
import { llmParseOkrUpdate } from "@/lib/integrations/llm-okr-parser";
import { eq, and, desc } from "drizzle-orm";

/** Map channel name to pillar for grouping */
function derivePillar(channelName: string): string {
  if (channelName.includes("growth")) return "Growth";
  if (channelName.includes("ewa") || channelName.includes("credit"))
    return "EWA & Credit Products";
  if (channelName.includes("new-bets")) return "New Bets";
  if (channelName.includes("chat")) return "Chat";
  if (channelName.includes("access") || channelName.includes("trust") || channelName.includes("risk"))
    return "Access, Trust & Money, Risk & Payments";
  if (channelName.includes("card")) return "Card";
  return "Other";
}

/** Quick filter to skip messages that are clearly not OKR updates. */
function isLikelyUpdate(text: string, subtype?: string): boolean {
  if (!text || subtype) return false; // Skip system messages (joins, etc.)
  if (text.length < 200) return false; // Too short for an OKR update
  if (/^Reminder:/i.test(text)) return false; // Bot reminders
  if (/has joined the channel/.test(text)) return false;
  if (/^Happy Monday/i.test(text)) return false; // Weekly reminder bot
  return true;
}

/**
 * Sync OKR updates from a single Slack channel using LLM parsing.
 */
async function syncChannel(
  channelId: string,
  lastSyncTs?: string
): Promise<number> {
  const channelName = await getChannelName(channelId);
  const pillar = derivePillar(channelName);
  const channelContext = `#${channelName} (${pillar} pillar)`;

  // Fetch messages since last sync (or last 30 days)
  const oldest =
    lastSyncTs ??
    String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  const messages = await getChannelHistory(channelId, oldest);

  let count = 0;

  for (const msg of messages) {
    if (!isLikelyUpdate(msg.text, msg.subtype)) continue;

    // LLM parse
    const parsed = await llmParseOkrUpdate(msg.text, channelContext);
    if (!parsed || parsed.krs.length === 0) continue;

    const userName = msg.user ? await getUserName(msg.user) : null;
    const postedAt = new Date(parseFloat(msg.ts) * 1000);

    for (const kr of parsed.krs) {
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
          objectiveName: kr.objective,
          krName: kr.name,
          status: kr.rag === "green"
            ? "on_track"
            : kr.rag === "amber"
              ? "at_risk"
              : kr.rag === "red"
                ? "behind"
                : "not_started",
          actual: kr.metric ?? null,
          target: null,
          tldr: parsed.tldr ?? null,
          rawText: msg.text.slice(0, 10000),
          postedAt,
        })
        .onConflictDoUpdate({
          target: [okrUpdates.slackTs, okrUpdates.channelId, okrUpdates.krName],
          set: {
            status: kr.rag === "green"
              ? "on_track"
              : kr.rag === "amber"
                ? "at_risk"
                : kr.rag === "red"
                  ? "behind"
                  : "not_started",
            actual: kr.metric ?? null,
            tldr: parsed.tldr ?? null,
            syncedAt: new Date(),
          },
        });

      count++;
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

  const [log] = await db
    .insert(syncLog)
    .values({ source: "slack" })
    .returning();

  try {
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
