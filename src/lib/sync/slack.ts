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
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
  throwIfSyncShouldStop,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";
import * as Sentry from "@sentry/nextjs";

const SLACK_THREAD_REPLY_CONCURRENCY = 5;

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

/** Resolve a Slack user ID to a display name, falling back to seed data.
 *
 * `localCache` is a sync-local Map<userId, resolvedName> that persists across
 * all calls within a single syncChannel() run. It caches every outcome —
 * successful Slack display names, fallback PM names, and raw user IDs returned
 * when the Slack API lookup fails — so repeated authors within a run perform at
 * most one resolution attempt per userId.
 */
async function resolveAuthorName(
  userId: string,
  fallback: Map<string, string>,
  localCache: Map<string, string>,
  opts: SyncControl = {}
): Promise<string> {
  if (localCache.has(userId)) return localCache.get(userId)!;
  const name = await getUserName(userId, { signal: opts.signal });
  const resolved = name === userId && fallback.has(userId) ? fallback.get(userId)! : name;
  localCache.set(userId, resolved);
  return resolved;
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrencyLimit: number,
  mapper: (item: T, index: number) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> {
  const settledResults: PromiseSettledResult<TResult>[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrencyLimit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        const value = await mapper(items[currentIndex], currentIndex);
        settledResults[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        settledResults[currentIndex] = { status: "rejected", reason };
      }
    }
  });

  const workerResults = await Promise.allSettled(workers);
  const rejectedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejectedWorker) {
    throw rejectedWorker.reason;
  }

  return settledResults;
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

/**
 * Sync OKR updates from a single Slack channel using LLM parsing.
 */
async function syncChannel(
  channelId: string,
  lastSyncTs: string | undefined,
  systemPrompt: string,
  userNameFallback: Map<string, string>,
  opts: SyncControl = {}
): Promise<number> {
  throwIfSyncShouldStop(opts, {
    cancelled: "Slack sync cancelled before channel fetch started",
    deadlineExceeded:
      "Slack sync exceeded its execution budget before channel fetch started",
  });

  const channelName = await getChannelName(channelId, { signal: opts.signal });
  const pillar = derivePillar(channelName);
  const channelContext = `#${channelName} (${pillar} pillar)`;

  const oldest =
    lastSyncTs ??
    String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  const topLevelMessages = await getChannelHistory(channelId, oldest, undefined, {
    signal: opts.signal,
  });
  const threadParents = topLevelMessages.filter(
    (msg) => msg.reply_count && msg.reply_count > 0
  );
  const replyFetchResults = await mapWithConcurrencyLimit(
    threadParents,
    SLACK_THREAD_REPLY_CONCURRENCY,
    async (msg) => {
      throwIfSyncShouldStop(opts, {
        cancelled: "Slack sync cancelled while expanding threads",
        deadlineExceeded:
          "Slack sync exceeded its execution budget while expanding threads",
      });

      return getThreadReplies(channelId, msg.ts, {
        signal: opts.signal,
      });
    }
  );

  const repliesByParentTs = new Map<string, Awaited<ReturnType<typeof getThreadReplies>>>();
  for (const [index, result] of replyFetchResults.entries()) {
    if (result.status === "rejected") {
      throw result.reason;
    }

    repliesByParentTs.set(threadParents[index].ts, result.value);
  }

  const messages = [];
  for (const msg of topLevelMessages) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Slack sync cancelled while expanding threads",
      deadlineExceeded:
        "Slack sync exceeded its execution budget while expanding threads",
    });

    messages.push(msg);
    if (msg.reply_count && msg.reply_count > 0) {
      messages.push(...(repliesByParentTs.get(msg.ts) ?? []));
    }
  }

  let count = 0;
  const authorNameCache = new Map<string, string>();

  for (const msg of messages) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Slack sync cancelled while parsing messages",
      deadlineExceeded:
        "Slack sync exceeded its execution budget while parsing messages",
    });

    if (!isLikelyUpdate(msg.text, msg.subtype)) continue;

    const authorName = msg.user
      ? await resolveAuthorName(msg.user, userNameFallback, authorNameCache, opts)
      : "unknown";

    const parsed = await llmParseOkrUpdate(
      msg.text,
      `${channelContext}\nAuthor: ${authorName}`,
      systemPrompt,
      { signal: opts.signal }
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
          status:
            kr.rag === "green"
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
            status:
              kr.rag === "green"
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

type SlackSyncResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

async function failSlackPreflightPhase(
  tracker: ReturnType<typeof createPhaseTracker>,
  phaseId: number,
  phaseLabel: string,
  error: unknown
): Promise<SlackSyncResult> {
  const message = `Failed to ${phaseLabel}: ${formatSyncError(error)}`;
  await tracker.endPhase(phaseId, {
    status: "error",
    errorMessage: message,
  });

  return {
    status: "error",
    recordsSynced: 0,
    errors: [message],
  };
}

/**
 * Sync all configured OKR channels.
 */
export async function runSlackSync(
  run: { id: number },
  opts: SyncControl = {}
): Promise<SlackSyncResult> {
  Sentry.setTag("sync_source", "slack");
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
    try {
      await seedSquads();
    } catch (error) {
      return failSlackPreflightPhase(tracker, phaseId, "seed squads", error);
    }
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
    let userNameFallback: Map<string, string>;
    try {
      userNameFallback = await buildUserNameFallback();
    } catch (error) {
      return failSlackPreflightPhase(
        tracker,
        phaseId,
        "load user name fallback map",
        error
      );
    }
    await tracker.endPhase(phaseId, {
      itemsProcessed: userNameFallback.size,
      detail: `Loaded ${userNameFallback.size} user mappings`,
    });

    phaseId = await tracker.startPhase(
      "fetch_last_sync",
      "Checking last successful sync time"
    );
    let lastSyncTs: string | undefined;
    try {
      lastSyncTs = await fetchLastSlackSuccessTimestamp();
    } catch (error) {
      return failSlackPreflightPhase(
        tracker,
        phaseId,
        "fetch last successful sync time",
        error
      );
    }
    await tracker.endPhase(phaseId, {
      detail: lastSyncTs
        ? `Since ${new Date(Number(lastSyncTs) * 1000).toISOString()}`
        : "Full scan (no prior sync)",
    });

    for (const channelId of channelIds) {
      throwIfSyncShouldStop(opts, {
        cancelled: "Slack sync cancelled between channels",
        deadlineExceeded:
          "Slack sync exceeded its execution budget between channels",
      });

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

        if (error instanceof SyncDeadlineExceededError) {
          await tracker.endPhase(channelPhaseId, {
            status: "error",
            detail: "Execution budget exceeded before channel completed",
            errorMessage: error.message,
          });
          throw error;
        }

        const message = `Failed to sync channel ${channelId}: ${formatSyncError(error)}`;
        errors.push(message);
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
    if (error instanceof SyncDeadlineExceededError) {
      return {
        status: totalRecords > 0 ? "partial" : "error",
        recordsSynced: totalRecords,
        errors: [...errors, error.message],
      };
    }

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
