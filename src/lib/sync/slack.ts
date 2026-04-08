import { db } from "@/lib/db";
import { okrUpdates, squads, syncLog } from "@/lib/db/schema";
import {
  getChannelHistory,
  getChannelName,
  getThreadReplies,
  getUserName,
} from "@/lib/integrations/slack";
import {
  buildSquadContext,
  buildSystemPromptFromContext,
  llmParseOkrUpdate,
} from "@/lib/integrations/llm-okr-parser";
import { seedSquads } from "@/lib/data/seed-squads";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";
import { SyncCancelledError } from "./errors";
import { determineSyncStatus } from "./coordinator";

/** Build a local userId → pmName lookup from the squads table (fallback when Slack API lacks users:read). */
async function buildUserNameFallback(): Promise<Map<string, string>> {
  const rows = await db
    .select({ pmSlackId: squads.pmSlackId, pmName: squads.pmName })
    .from(squads)
    .where(and(eq(squads.isActive, true), isNotNull(squads.pmSlackId)));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.pmSlackId && row.pmName) map.set(row.pmSlackId, row.pmName);
  }
  return map;
}

/** Resolve a Slack user ID to a display name, falling back to seed data. */
async function resolveAuthorName(
  userId: string,
  fallback: Map<string, string>
): Promise<string> {
  const name = await getUserName(userId);
  if (name === userId && fallback.has(userId)) {
    return fallback.get(userId)!;
  }
  return name;
}

/** Map channel name to pillar for grouping */
function derivePillar(channelName: string): string {
  if (channelName.includes("growth")) return "Growth";
  if (channelName.includes("ewa") || channelName.includes("credit")) {
    return "EWA & Credit Products";
  }
  if (channelName.includes("new-bets")) return "New Bets";
  if (channelName.includes("chat")) return "Chat";
  if (
    channelName.includes("access") ||
    channelName.includes("trust") ||
    channelName.includes("risk")
  ) {
    return "Access, Trust & Money, Risk & Payments";
  }
  if (channelName.includes("card")) return "Card";
  return "Other";
}

/** Quick filter to skip messages that are clearly not OKR updates. */
function isLikelyUpdate(text: string, subtype?: string): boolean {
  if (!text || subtype) return false;
  if (text.length < 150) return false;
  if (/^Reminder:/i.test(text)) return false;
  if (/has joined the channel/.test(text)) return false;
  if (/^Happy Monday/i.test(text)) return false;
  if (/^<!subteam\^/.test(text)) return false;
  if (/^<@\w+> has joined/.test(text)) return false;
  if (/^Hey <!here>/.test(text)) return false;
  if (/^Following from/.test(text)) return false;
  if (/^\*Agenda/.test(text)) return false;
  if (/^\*Product Crit/.test(text)) return false;
  if (/^Action items/i.test(text)) return false;
  if (/^Separately/i.test(text)) return false;
  if (text.startsWith("/")) return false;
  return true;
}

type OkrStatus = "on_track" | "at_risk" | "behind" | "not_started";

function ragToStatus(rag: "green" | "amber" | "red" | "not_started"): OkrStatus {
  if (rag === "green") return "on_track";
  if (rag === "amber") return "at_risk";
  if (rag === "red") return "behind";
  return "not_started";
}

/**
 * Sync OKR updates from a single Slack channel using LLM parsing.
 */
async function syncChannel(
  channelId: string,
  lastSyncTs: string | undefined,
  systemPrompt: string,
  userNameFallback: Map<string, string>,
  opts: { shouldStop?: () => boolean } = {}
): Promise<number> {
  const channelName = await getChannelName(channelId);
  const pillar = derivePillar(channelName);
  const channelContext = `#${channelName} (${pillar} pillar)`;

  const oldest =
    lastSyncTs ??
    String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  const topLevelMessages = await getChannelHistory(channelId, oldest);
  const messages = [];

  for (const msg of topLevelMessages) {
    if (opts.shouldStop?.()) {
      throw new SyncCancelledError("Slack sync cancelled while expanding threads");
    }

    messages.push(msg);
    if (msg.reply_count && msg.reply_count > 0) {
      const replies = await getThreadReplies(channelId, msg.ts);
      messages.push(...replies);
    }
  }

  let count = 0;

  for (const msg of messages) {
    if (opts.shouldStop?.()) {
      throw new SyncCancelledError("Slack sync cancelled while parsing messages");
    }

    if (!isLikelyUpdate(msg.text, msg.subtype)) continue;

    const authorName = msg.user
      ? await resolveAuthorName(msg.user, userNameFallback)
      : "unknown";

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
          status: ragToStatus(kr.rag),
          actual: kr.metric ?? null,
          target: null,
          tldr: parsed.tldr ?? null,
          rawText: msg.text.slice(0, 10000),
          postedAt,
        })
        .onConflictDoUpdate({
          target: [okrUpdates.slackTs, okrUpdates.channelId, okrUpdates.krName],
          set: {
            status: ragToStatus(kr.rag),
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

async function fetchLastSlackSuccessTimestamp(): Promise<string | undefined> {
  const rows = await db
    .select({ completedAt: syncLog.completedAt })
    .from(syncLog)
    .where(and(eq(syncLog.source, "slack"), inArray(syncLog.status, ["success", "partial"])))
    .orderBy(desc(syncLog.completedAt))
    .limit(1);

  return rows[0]?.completedAt
    ? String(rows[0].completedAt.getTime() / 1000)
    : undefined;
}

/**
 * Sync all configured OKR channels.
 */
export async function runSlackSync(
  run: { id: number },
  opts: { shouldStop?: () => boolean } = {}
): Promise<{
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
}> {
  const channelIds = (process.env.SLACK_OKR_CHANNEL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (channelIds.length === 0) {
    return { status: "success", recordsSynced: 0, errors: [] };
  }

  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  let succeededChannels = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase("seed_squads", "Seeding squad definitions");
    await seedSquads();
    await tracker.endPhase(phaseId);

    phaseId = await tracker.startPhase(
      "build_context",
      "Building LLM system prompt from squad context"
    );
    const squadContext = await buildSquadContext();
    const systemPrompt = buildSystemPromptFromContext(squadContext);
    await tracker.endPhase(phaseId);

    phaseId = await tracker.startPhase(
      "build_user_fallback",
      "Loading user name fallback map"
    );
    const userNameFallback = await buildUserNameFallback();
    await tracker.endPhase(phaseId, {
      itemsProcessed: userNameFallback.size,
      detail: `Loaded ${userNameFallback.size} user mappings`,
    });

    phaseId = await tracker.startPhase(
      "fetch_last_sync",
      "Checking last successful sync time"
    );
    const lastSyncTs = await fetchLastSlackSuccessTimestamp();
    await tracker.endPhase(phaseId, {
      detail: lastSyncTs
        ? `Since ${new Date(Number(lastSyncTs) * 1000).toISOString()}`
        : "Full scan (no prior sync)",
    });

    for (const channelId of channelIds) {
      if (opts.shouldStop?.()) {
        throw new SyncCancelledError("Slack sync cancelled between channels");
      }

      const channelPhaseId = await tracker.startPhase(
        `sync_channel:${channelId}`,
        "Fetching messages and parsing OKRs"
      );

      try {
        const count = await syncChannel(
          channelId,
          lastSyncTs,
          systemPrompt,
          userNameFallback,
          opts
        );
        totalRecords += count;
        succeededChannels += 1;
        await tracker.endPhase(channelPhaseId, {
          itemsProcessed: count,
          detail: `Parsed ${count} key results`,
        });
      } catch (error) {
        if (error instanceof SyncCancelledError) {
          await tracker.endPhase(channelPhaseId, {
            status: "skipped",
            detail: "Cancelled before channel completed",
            errorMessage: error.message,
          });
          throw error;
        }

        const message = `Failed to sync channel ${channelId}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        errors.push(message);
        console.error(message);
        await tracker.endPhase(channelPhaseId, {
          status: "error",
          errorMessage: message,
        });
      }
    }

    return {
      status: determineSyncStatus(errors, succeededChannels),
      recordsSynced: totalRecords,
      errors,
    };
  } catch (error) {
    if (error instanceof SyncCancelledError) {
      return {
        status: "cancelled",
        recordsSynced: totalRecords,
        errors: [...errors, error.message],
      };
    }

    throw error;
  }
}
