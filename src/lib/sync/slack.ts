import { db } from "@/lib/db";
import { okrUpdates, squads, syncLog } from "@/lib/db/schema";
import { getChannelHistory, getChannelName, getThreadReplies, getUserName } from "@/lib/integrations/slack";
import { llmParseOkrUpdate, buildSquadContext, buildSystemPromptFromContext } from "@/lib/integrations/llm-okr-parser";
import { seedSquads } from "@/lib/data/seed-squads";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";

/** Build a local userId → pmName lookup from the squads table (fallback when Slack API lacks users:read). */
async function buildUserNameFallback(): Promise<Map<string, string>> {
  const rows = await db
    .select({ pmSlackId: squads.pmSlackId, pmName: squads.pmName })
    .from(squads)
    .where(and(eq(squads.isActive, true), isNotNull(squads.pmSlackId)));
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.pmSlackId && r.pmName) map.set(r.pmSlackId, r.pmName);
  }
  return map;
}

/** Resolve a Slack user ID to a display name, falling back to seed data. */
async function resolveAuthorName(
  userId: string,
  fallback: Map<string, string>
): Promise<string> {
  const name = await getUserName(userId);
  // getUserName returns the raw ID when the API call fails (missing users:read scope)
  if (name === userId && fallback.has(userId)) {
    return fallback.get(userId)!;
  }
  return name;
}

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
  if (text.length < 150) return false; // Too short for an OKR update
  if (/^Reminder:/i.test(text)) return false; // Bot reminders
  if (/has joined the channel/.test(text)) return false;
  if (/^Happy Monday/i.test(text)) return false; // Weekly reminder bot
  if (/^<!subteam\^/.test(text)) return false; // @team mentions (reminders)
  if (/^<@\w+> has joined/.test(text)) return false;
  if (/^Hey <!here>/.test(text)) return false; // General announcements
  if (/^Following from/.test(text)) return false; // Meeting follow-ups
  if (/^\*Agenda/.test(text)) return false; // Meeting agendas
  if (/^\*Product Crit/.test(text)) return false;
  if (/^Action items/i.test(text)) return false;
  if (/^Separately/i.test(text)) return false;
  if (text.startsWith("/")) return false; // Slash commands
  return true;
}

/**
 * Sync OKR updates from a single Slack channel using LLM parsing.
 */
async function syncChannel(
  channelId: string,
  lastSyncTs: string | undefined,
  systemPrompt: string,
  userNameFallback: Map<string, string>
): Promise<number> {
  const channelName = await getChannelName(channelId);
  const pillar = derivePillar(channelName);
  const channelContext = `#${channelName} (${pillar} pillar)`;

  // Fetch messages since last sync (or last 30 days)
  const oldest =
    lastSyncTs ??
    String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  const topLevelMessages = await getChannelHistory(channelId, oldest);

  // Expand thread replies — PMs sometimes post OKR updates as replies
  const messages = [];
  for (const msg of topLevelMessages) {
    messages.push(msg);
    if (msg.reply_count && msg.reply_count > 0) {
      const replies = await getThreadReplies(channelId, msg.ts);
      messages.push(...replies);
    }
  }

  let count = 0;

  for (const msg of messages) {
    if (!isLikelyUpdate(msg.text, msg.subtype)) continue;

    // Resolve author name for LLM context (falls back to seed data if API lacks users:read)
    const authorName = msg.user ? await resolveAuthorName(msg.user, userNameFallback) : "unknown";

    // LLM parse with author context
    const parsed = await llmParseOkrUpdate(
      msg.text,
      `${channelContext}\nAuthor: ${authorName}`,
      systemPrompt
    );
    if (!parsed || parsed.krs.length === 0) continue;
    const postedAt = new Date(parseFloat(msg.ts) * 1000);

    for (const kr of parsed.krs) {
      await db
        .insert(okrUpdates)
        .values({
          slackTs: msg.ts,
          channelId,
          channelName,
          userId: msg.user ?? null,
          userName: authorName !== "unknown" ? authorName : null,
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

  const tracker = createPhaseTracker(log.id);

  try {
    // Seed squads and build LLM context once
    let phaseId = await tracker.startPhase("seed_squads", "Seeding squad definitions");
    await seedSquads();
    await tracker.endPhase(phaseId);

    phaseId = await tracker.startPhase("build_context", "Building LLM system prompt from squad context");
    const squadContext = await buildSquadContext();
    const systemPrompt = buildSystemPromptFromContext(squadContext);
    await tracker.endPhase(phaseId);

    phaseId = await tracker.startPhase("build_user_fallback", "Loading user name fallback map");
    const userNameFallback = await buildUserNameFallback();
    await tracker.endPhase(phaseId, { itemsProcessed: userNameFallback.size, detail: `Loaded ${userNameFallback.size} user mappings` });

    phaseId = await tracker.startPhase("fetch_last_sync", "Checking last successful sync time");
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
    await tracker.endPhase(phaseId, { detail: lastSyncTs ? `Since ${lastSync[0].completedAt!.toISOString()}` : "Full scan (no prior sync)" });

    let totalRecords = 0;
    const errors: string[] = [];

    for (const channelId of channelIds) {
      const channelPhaseId = await tracker.startPhase(`sync_channel:${channelId}`, "Fetching messages and parsing OKRs");
      try {
        const count = await syncChannel(channelId, lastSyncTs, systemPrompt, userNameFallback);
        totalRecords += count;
        await tracker.endPhase(channelPhaseId, { itemsProcessed: count, detail: `Parsed ${count} key results` });
      } catch (err) {
        const message = `Failed to sync channel ${channelId}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        console.error(message);
        await tracker.endPhase(channelPhaseId, { status: "error", errorMessage: message });
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
