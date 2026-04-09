import { db } from "@/lib/db";
import { okrUpdates, squads, syncLog } from "@/lib/db/schema";
import {
  checkSlackHealth,
  getChannelHistory,
  getChannelName,
  getThreadReplies,
  getUserName,
  isSlackChannelNotFoundError,
} from "@/lib/integrations/slack";
import {
  buildSquadContext,
  buildSystemPromptFromContext,
  llmParseOkrUpdates,
  type OkrParseInput,
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
const SLACK_OKR_PARSE_BATCH_SIZE = 4;

type SlackSyncScope = {
  slackChannelCheckpoints?: Record<string, string>; // channelId -> latestMessageTs
};

type SyncChannelResult = {
  krCount: number;
  parsedMessageCount: number;
  skippedByFilterCount: number;
  llmNullCount: number;
  emptyAfterValidationCount: number;
  latestMessageTs: string | undefined;
};

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

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
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
  channel: { id: string; name: string },
  lastSyncTs: string | undefined,
  systemPrompt: string,
  userNameFallback: Map<string, string>,
  opts: SyncControl = {}
): Promise<SyncChannelResult> {
  throwIfSyncShouldStop(opts, {
    cancelled: "Slack sync cancelled before channel fetch started",
    deadlineExceeded:
      "Slack sync exceeded its execution budget before channel fetch started",
  });

  const channelId = channel.id;
  const channelName = channel.name;
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

  let krCount = 0;
  let parsedMessageCount = 0;
  let skippedByFilterCount = 0;
  let llmNullCount = 0;
  let emptyAfterValidationCount = 0;
  let latestMessageTs: string | undefined;
  const authorNameCache = new Map<string, string>();
  const parseCandidates: Array<{
    authorName: string;
    channelContext: string;
    msg: (typeof messages)[number];
  }> = [];

  for (const msg of messages) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Slack sync cancelled while parsing messages",
      deadlineExceeded:
        "Slack sync exceeded its execution budget while parsing messages",
    });

    if (!latestMessageTs || msg.ts > latestMessageTs) {
      latestMessageTs = msg.ts;
    }

    if (!isLikelyUpdate(msg.text, msg.subtype)) {
      skippedByFilterCount += 1;
      continue;
    }

    const authorName = msg.user
      ? await resolveAuthorName(msg.user, userNameFallback, authorNameCache, opts)
      : "unknown";
    parseCandidates.push({
      authorName,
      channelContext: `${channelContext}\nAuthor: ${authorName}`,
      msg,
    });
  }

  for (const batch of chunkArray(parseCandidates, SLACK_OKR_PARSE_BATCH_SIZE)) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Slack sync cancelled while parsing messages",
      deadlineExceeded:
        "Slack sync exceeded its execution budget while parsing messages",
    });

    const parsedBatch = await llmParseOkrUpdates(
      batch.map<OkrParseInput>(({ channelContext, msg }) => ({
        messageText: msg.text,
        channelContext,
      })),
      systemPrompt,
      { signal: opts.signal }
    );
    parsedMessageCount += batch.length;

    for (const [index, parsed] of parsedBatch.entries()) {
      throwIfSyncShouldStop(opts, {
        cancelled: "Slack sync cancelled while storing parsed OKRs",
        deadlineExceeded:
          "Slack sync exceeded its execution budget while storing parsed OKRs",
      });

      const { authorName, msg } = batch[index];
      if (!parsed) {
        llmNullCount += 1;
        continue;
      }
      if (parsed.krs.length === 0) {
        emptyAfterValidationCount += 1;
        continue;
      }

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

        krCount++;
      }
    }
  }

  Sentry.addBreadcrumb({
    category: "sync.slack",
    level: "info",
    message: "Completed Slack channel OKR parsing",
    data: {
      channelId,
      channelName,
      krCount,
      parsedMessageCount,
      skippedByFilterCount,
      llmNullCount,
      emptyAfterValidationCount,
    },
  });

  return {
    krCount,
    parsedMessageCount,
    skippedByFilterCount,
    llmNullCount,
    emptyAfterValidationCount,
    latestMessageTs,
  };
}

function formatChannelPhaseDetail(
  channelName: string,
  result: SyncChannelResult
): string {
  const base = `#${channelName}: Parsed ${result.krCount} KRs from ${result.parsedMessageCount} messages (${result.skippedByFilterCount} filtered, ${result.llmNullCount} LLM null`;

  return result.emptyAfterValidationCount > 0
    ? `${base}, ${result.emptyAfterValidationCount} empty after validation)`
    : `${base})`;
}

async function validateSlackChannels(
  channelIds: readonly string[],
  runId: number,
  opts: SyncControl = {}
): Promise<{
  validChannels: Array<{ id: string; name: string }>;
  invalidChannelIds: string[];
  invalidMessages: string[];
}> {
  const validChannels: Array<{ id: string; name: string }> = [];
  const invalidChannelIds: string[] = [];
  const invalidMessages: string[] = [];

  for (const channelId of channelIds) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Slack sync cancelled during channel validation",
      deadlineExceeded:
        "Slack sync exceeded its execution budget during channel validation",
    });

    try {
      const channelName = await getChannelName(channelId, { signal: opts.signal });
      validChannels.push({ id: channelId, name: channelName });
    } catch (error) {
      if (!isSlackChannelNotFoundError(error)) {
        throw error;
      }

      const message = `Skipped invalid Slack channel ${channelId}: ${formatSyncError(error)}`;
      invalidChannelIds.push(channelId);
      invalidMessages.push(message);

      Sentry.captureMessage(message, {
        level: "warning",
        tags: {
          sync_source: "slack",
        },
        extra: {
          runId,
          channelId,
          status: error.status,
          code: error.code,
        },
      });
    }
  }

  return {
    validChannels,
    invalidChannelIds,
    invalidMessages,
  };
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

function getSlackChannelCheckpoints(scope: unknown): Record<string, string> {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return {};
  }
  const checkpoints = (scope as SlackSyncScope).slackChannelCheckpoints;
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [channelId, ts] of Object.entries(checkpoints)) {
    if (typeof ts === "string") {
      result[channelId] = ts;
    }
  }
  return result;
}

async function fetchResumableSlackCheckpoints(): Promise<Record<string, string>> {
  const rows = await db
    .select({ scope: syncLog.scope })
    .from(syncLog)
    .where(
      and(
        eq(syncLog.source, "slack"),
        inArray(syncLog.status, ["partial", "error", "cancelled"])
      )
    )
    .orderBy(desc(syncLog.startedAt))
    .limit(1);

  return getSlackChannelCheckpoints(rows[0]?.scope);
}

async function checkpointSlackSyncProgress(
  runId: number,
  recordsSynced: number,
  channelCheckpoints: Record<string, string>,
): Promise<void> {
  const now = new Date();
  await db
    .update(syncLog)
    .set({
      status: "running",
      recordsSynced,
      heartbeatAt: now,
      scope: { slackChannelCheckpoints: channelCheckpoints },
    })
    .where(and(eq(syncLog.id, runId), eq(syncLog.status, "running")));
}

type SlackSyncResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

async function failSlackPreflightPhase(
  tracker: ReturnType<typeof createPhaseTracker>,
  runId: number,
  phaseId: number,
  phaseLabel: string,
  error: unknown
): Promise<SlackSyncResult> {
  const message = `Failed to ${phaseLabel}: ${formatSyncError(error)}`;
  Sentry.captureException(error, {
    tags: {
      sync_source: "slack",
      failure_scope: "preflight",
    },
    extra: {
      runId,
      phaseLabel,
      message,
    },
  });
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

async function failSlackHealthCheck(
  tracker: ReturnType<typeof createPhaseTracker>,
  runId: number,
  phaseId: number,
  error: unknown,
): Promise<SlackSyncResult> {
  const message = `Slack API unreachable, skipping sync: ${formatSyncError(error)}`;
  Sentry.captureMessage("Slack API unreachable, skipping sync", {
    level: "warning",
    tags: {
      sync_source: "slack",
      failure_scope: "health_check",
    },
    extra: {
      runId,
      message,
    },
  });
  await tracker.endPhase(phaseId, {
    status: "error",
    detail: "Slack API unreachable, sync skipped",
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
    Sentry.captureMessage("Slack sync completed", {
      level: "info",
      tags: {
        sync_source: "slack",
        status: "success",
      },
      extra: {
        runId: run.id,
        recordsSynced: 0,
      },
    });
    return { status: "success", recordsSynced: 0, errors: [] };
  }

  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  let succeededChannels = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase(
      "health_check",
      "Checking Slack API connectivity"
    );
    try {
      await checkSlackHealth({ signal: opts.signal });
    } catch (error) {
      return failSlackHealthCheck(tracker, run.id, phaseId, error);
    }
    await tracker.endPhase(phaseId, {
      detail: "Slack API reachable",
    });

    phaseId = await tracker.startPhase("seed_squads", "Seeding squad definitions");
    try {
      await seedSquads();
    } catch (error) {
      return failSlackPreflightPhase(tracker, run.id, phaseId, "seed squads", error);
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
        run.id,
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
        run.id,
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

    let channelCheckpoints: Record<string, string> = {};
    try {
      channelCheckpoints = await fetchResumableSlackCheckpoints();
    } catch {
      // Non-fatal: fall back to global lastSyncTs for all channels
    }

    phaseId = await tracker.startPhase(
      "validate_channels",
      "Validating configured Slack channel IDs"
    );
    let validChannels: Array<{ id: string; name: string }>;
    let invalidChannelIds: string[];
    let invalidMessages: string[];
    try {
      const validationResult = await validateSlackChannels(channelIds, run.id, opts);
      validChannels = validationResult.validChannels;
      invalidChannelIds = validationResult.invalidChannelIds;
      invalidMessages = validationResult.invalidMessages;
    } catch (error) {
      return failSlackPreflightPhase(
        tracker,
        run.id,
        phaseId,
        "validate configured Slack channel IDs",
        error
      );
    }
    errors.push(...invalidMessages);
    await tracker.endPhase(phaseId, {
      itemsProcessed: validChannels.length,
      detail:
        invalidMessages.length > 0
          ? `Validated ${validChannels.length} channels; skipped ${invalidMessages.length} invalid: ${invalidChannelIds.join(", ")}`
          : `Validated ${validChannels.length} channels; skipped 0 invalid`,
    });

    for (const channel of validChannels) {
      throwIfSyncShouldStop(opts, {
        cancelled: "Slack sync cancelled between channels",
        deadlineExceeded:
          "Slack sync exceeded its execution budget between channels",
      });

      const channelPhaseId = await tracker.startPhase(
        `sync_channel:${channel.id}`,
        "Fetching messages and parsing OKRs"
      );

      const channelCursor = channelCheckpoints[channel.id] ?? lastSyncTs;

      try {
        const result = await syncChannel(
          channel,
          channelCursor,
          systemPrompt,
          userNameFallback,
          opts
        );
        totalRecords += result.krCount;
        succeededChannels += 1;
        if (result.latestMessageTs) {
          channelCheckpoints[channel.id] = result.latestMessageTs;
        }
        await checkpointSlackSyncProgress(run.id, totalRecords, channelCheckpoints);
        await tracker.endPhase(channelPhaseId, {
          itemsProcessed: result.krCount,
          detail: formatChannelPhaseDetail(channel.name, result),
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

        const message = `Failed to sync channel ${channel.id}: ${formatSyncError(error)}`;
        errors.push(message);
        await tracker.endPhase(channelPhaseId, {
          status: "error",
          errorMessage: message,
        });
      }
    }

    const status = determineSyncStatus(errors, succeededChannels);
    if (status === "success" || status === "partial") {
      Sentry.captureMessage("Slack sync completed", {
        level: "info",
        tags: {
          sync_source: "slack",
          status,
        },
        extra: {
          runId: run.id,
          recordsSynced: totalRecords,
        },
      });
    }

    return { status, recordsSynced: totalRecords, errors };
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

    Sentry.captureException(error, {
      tags: {
        sync_source: "slack",
        failure_scope: "run",
      },
      extra: {
        runId: run.id,
        recordsSynced: totalRecords,
        succeededChannels,
      },
    });
    throw error;
  }
}
