import { db } from "@/lib/db";
import { meetingNotes, preReads, syncLog } from "@/lib/db/schema";
import { getAllNotesSince, getNote, type GranolaNote } from "@/lib/integrations/granola";
import {
  getChannelHistory,
  getUserName,
  type SlackMessage,
} from "@/lib/integrations/slack";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
  throwIfSyncShouldStop,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";

type MeetingsSyncResult = {
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
};

function getPreReadsChannelId(): string | null {
  return process.env.SLACK_PRE_READS_CHANNEL_ID?.trim() || null;
}

async function fetchLastMeetingsSyncTimestamp(): Promise<Date | undefined> {
  const rows = await db
    .select({ completedAt: syncLog.completedAt })
    .from(syncLog)
    .where(
      and(
        eq(syncLog.source, "meetings"),
        inArray(syncLog.status, ["success", "partial"])
      )
    )
    .orderBy(desc(syncLog.completedAt))
    .limit(1);

  return rows[0]?.completedAt ?? undefined;
}

// ---------------------------------------------------------------------------
// Granola sync
// ---------------------------------------------------------------------------

async function syncGranolaNotes(
  sinceDate: Date,
  opts: SyncControl = {}
): Promise<{ count: number; errors: string[] }> {
  let noteList: GranolaNote[];
  try {
    noteList = await getAllNotesSince(sinceDate.toISOString(), {
      signal: opts.signal,
    });
  } catch (error) {
    return {
      count: 0,
      errors: [`Failed to fetch Granola notes: ${formatSyncError(error)}`],
    };
  }

  let count = 0;
  const errors: string[] = [];

  for (const note of noteList) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Meetings sync cancelled while storing Granola notes",
      deadlineExceeded: "Meetings sync exceeded budget while storing Granola notes",
    });

    try {
      const full = await getNote(note.id, {
        includeTranscript: true,
        signal: opts.signal,
      });

      const transcriptText = full.transcript
        ?.map((entry) => `${entry.speaker_source}: ${entry.text}`)
        .join("\n") ?? null;

      const summary = full.summary_markdown ?? full.summary_text ?? null;

      await db
        .insert(meetingNotes)
        .values({
          granolaMeetingId: full.id,
          title: full.title,
          summary,
          transcript: transcriptText,
          actionItems: null,
          participants: full.attendees ?? null,
          meetingDate: new Date(full.created_at),
          durationMinutes: null,
          calendarEventId: full.calendar_event?.organiser ?? null,
        })
        .onConflictDoUpdate({
          target: meetingNotes.granolaMeetingId,
          set: {
            title: full.title,
            summary,
            transcript: transcriptText,
            participants: full.attendees ?? null,
            syncedAt: new Date(),
          },
        });
      count++;
    } catch (error) {
      errors.push(`Failed to store Granola note ${note.id}: ${formatSyncError(error)}`);
    }
  }

  return { count, errors };
}

// ---------------------------------------------------------------------------
// Pre-reads sync (Slack #pre-reads channel)
// ---------------------------------------------------------------------------

async function syncPreReads(
  sinceTs: string | undefined,
  opts: SyncControl = {}
): Promise<{ count: number; errors: string[] }> {
  const channelId = getPreReadsChannelId();
  if (!channelId) {
    return { count: 0, errors: [] };
  }

  const oldest =
    sinceTs ?? String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000));

  let messages: SlackMessage[];
  try {
    messages = await getChannelHistory(channelId, oldest, undefined, {
      signal: opts.signal,
    });
  } catch (error) {
    return {
      count: 0,
      errors: [`Failed to fetch #pre-reads messages: ${formatSyncError(error)}`],
    };
  }

  let count = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    throwIfSyncShouldStop(opts, {
      cancelled: "Meetings sync cancelled while storing pre-reads",
      deadlineExceeded: "Meetings sync exceeded budget while storing pre-reads",
    });

    if (msg.subtype || !msg.text) continue;

    const userName = msg.user
      ? await getUserName(msg.user, { signal: opts.signal })
      : null;

    const postedAt = new Date(parseFloat(msg.ts) * 1000);

    const firstLine = msg.text.split("\n")[0]?.trim() ?? "";
    const title = firstLine.length > 200 ? firstLine.slice(0, 200) + "..." : firstLine;

    try {
      await db
        .insert(preReads)
        .values({
          slackTs: msg.ts,
          channelId,
          userId: msg.user ?? null,
          userName: userName !== msg.user ? userName : null,
          title: title || null,
          content: msg.text.slice(0, 50000),
          attachments: null,
          meetingDate: null,
          postedAt,
        })
        .onConflictDoUpdate({
          target: [preReads.slackTs, preReads.channelId],
          set: {
            content: msg.text.slice(0, 50000),
            userName: userName !== msg.user ? userName : null,
            syncedAt: new Date(),
          },
        });
      count++;
    } catch (error) {
      errors.push(`Failed to store pre-read ${msg.ts}: ${formatSyncError(error)}`);
    }
  }

  return { count, errors };
}

// ---------------------------------------------------------------------------
// Main runner — syncs Granola notes + Slack pre-reads
// (Google Calendar is fetched live per-user via Clerk OAuth, not synced)
// ---------------------------------------------------------------------------

export async function runMeetingsSync(
  run: { id: number },
  opts: SyncControl = {}
): Promise<MeetingsSyncResult> {
  const tracker = createPhaseTracker(run.id);
  let totalRecords = 0;
  let succeededSources = 0;
  const allErrors: string[] = [];

  try {
    // Determine sync window
    let phaseId = await tracker.startPhase(
      "fetch_last_sync",
      "Checking last successful meetings sync time"
    );
    let lastSync: Date | undefined;
    try {
      lastSync = await fetchLastMeetingsSyncTimestamp();
    } catch (error) {
      const message = `Failed to fetch last sync time: ${formatSyncError(error)}`;
      await tracker.endPhase(phaseId, { status: "error", errorMessage: message });
      return { status: "error", recordsSynced: 0, errors: [message] };
    }
    const sinceDate = lastSync ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await tracker.endPhase(phaseId, {
      detail: lastSync
        ? `Since ${lastSync.toISOString()}`
        : "Full scan (no prior sync)",
    });

    // Phase 1: Granola meeting notes
    throwIfSyncShouldStop(opts, {
      cancelled: "Meetings sync cancelled before Granola sync",
      deadlineExceeded: "Meetings sync exceeded budget before Granola sync",
    });

    phaseId = await tracker.startPhase("sync_granola", "Syncing Granola meeting notes");
    try {
      const granola = await syncGranolaNotes(sinceDate, opts);
      totalRecords += granola.count;
      allErrors.push(...granola.errors);
      if (granola.errors.length === 0 || granola.count > 0) succeededSources++;
      await tracker.endPhase(phaseId, {
        status: granola.errors.length > 0 && granola.count === 0 ? "error" : "success",
        itemsProcessed: granola.count,
        detail: `Synced ${granola.count} meeting notes`,
        errorMessage: granola.errors.length > 0 ? granola.errors.join("; ") : undefined,
      });
    } catch (error) {
      if (error instanceof SyncCancelledError || error instanceof SyncDeadlineExceededError) {
        await tracker.endPhase(phaseId, { status: "skipped", errorMessage: error.message });
        throw error;
      }
      const message = `Granola sync failed: ${formatSyncError(error)}`;
      allErrors.push(message);
      await tracker.endPhase(phaseId, { status: "error", errorMessage: message });
    }

    // Phase 2: Slack #pre-reads
    throwIfSyncShouldStop(opts, {
      cancelled: "Meetings sync cancelled before pre-reads sync",
      deadlineExceeded: "Meetings sync exceeded budget before pre-reads sync",
    });

    phaseId = await tracker.startPhase("sync_pre_reads", "Syncing Slack #pre-reads channel");
    const sinceTs = lastSync ? String(lastSync.getTime() / 1000) : undefined;
    try {
      const pr = await syncPreReads(sinceTs, opts);
      totalRecords += pr.count;
      allErrors.push(...pr.errors);
      if (pr.errors.length === 0 || pr.count > 0) succeededSources++;
      await tracker.endPhase(phaseId, {
        status: pr.errors.length > 0 && pr.count === 0 ? "error" : "success",
        itemsProcessed: pr.count,
        detail: `Synced ${pr.count} pre-reads`,
        errorMessage: pr.errors.length > 0 ? pr.errors.join("; ") : undefined,
      });
    } catch (error) {
      if (error instanceof SyncCancelledError || error instanceof SyncDeadlineExceededError) {
        await tracker.endPhase(phaseId, { status: "skipped", errorMessage: error.message });
        throw error;
      }
      const message = `Pre-reads sync failed: ${formatSyncError(error)}`;
      allErrors.push(message);
      await tracker.endPhase(phaseId, { status: "error", errorMessage: message });
    }

    return {
      status: determineSyncStatus(allErrors, succeededSources),
      recordsSynced: totalRecords,
      errors: allErrors,
    };
  } catch (error) {
    if (error instanceof SyncDeadlineExceededError) {
      return {
        status: totalRecords > 0 ? "partial" : "error",
        recordsSynced: totalRecords,
        errors: [...allErrors, error.message],
      };
    }

    if (error instanceof SyncCancelledError) {
      return {
        status: "cancelled",
        recordsSynced: totalRecords,
        errors: [...allErrors, error.message],
      };
    }

    throw error;
  }
}
