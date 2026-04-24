import { db } from "@/lib/db";
import { withDbErrorContext } from "@/lib/db/errors";
import { meetingNotes, preReads } from "@/lib/db/schema";
import { and, gte, lte, desc, like, or, inArray, sql, isNull, eq } from "drizzle-orm";
import {
  CalendarAuthError,
  getAllEvents,
  type CalendarEvent,
} from "@/lib/integrations/google-calendar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeetingRow {
  id: number;
  calendarEventId: string;
  title: string;
  description: string | null;
  startTime: string; // ISO string for serialization
  endTime: string;
  location: string | null;
  organizer: string | null;
  attendees: { email: string; name: string | null; responseStatus: string | null }[] | null;
  recurringEventId: string | null;
  htmlLink: string | null;
}

export interface PreReadRow {
  id: number;
  slackTs: string;
  channelId: string;
  userId: string | null;
  userName: string | null;
  title: string | null;
  content: string | null;
  postedAt: string; // ISO string
}

export interface MeetingNoteRow {
  id: number;
  granolaMeetingId: string;
  title: string;
  summary: string | null;
  transcript: string | null;
  participants: { name?: string; email: string }[] | null;
  meetingDate: string; // ISO string
  calendarEventId: string | null;
  isHistorical: boolean;
}

export interface LinkedMeeting extends MeetingRow {
  preReads: PreReadRow[];
  notes: MeetingNoteRow[];
}

export interface DayData {
  date: string; // YYYY-MM-DD
  meetings: LinkedMeeting[];
  unlinkedPreReads: PreReadRow[];
  unlinkedNotes: MeetingNoteRow[];
}

export interface MeetingsRangeResult {
  days: DayData[];
  /**
   * True when Clerk returned a Google access token but Google rejected it with
   * 401. Signals the user needs to reconnect (sign out/in). Pages should treat
   * this like `calendarConnected: false` so the reconnect CTA shows.
   */
  calendarAuthExpired: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract keywords from a meeting title for fuzzy matching. */
function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "for", "to", "in", "of", "with",
    "call", "meeting", "sync", "internal", "external", "weekly",
    "bi-weekly", "biweekly", "monthly", "update", "check-in",
    "pre-read", "pre", "read", "hold", "note", "f2f",
  ]);

  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/** Score how well a pre-read matches a meeting title (0 = no match). */
function matchScore(preReadContent: string, meetingKeywords: string[]): number {
  if (meetingKeywords.length === 0) return 0;
  const contentLower = preReadContent.toLowerCase();
  let hits = 0;
  for (const kw of meetingKeywords) {
    if (contentLower.includes(kw)) hits++;
  }
  // Require at least 2 keyword matches, or 1 if the meeting has very few keywords
  const threshold = meetingKeywords.length <= 2 ? 1 : 2;
  return hits >= threshold ? hits / meetingKeywords.length : 0;
}

/** Check if a meeting is a "work" meeting (has attendees). */
function isWorkMeeting(
  m: { attendees: unknown },
  minAttendees: number
): boolean {
  return Array.isArray(m.attendees) && m.attendees.length >= minAttendees;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/** Fetch meetings live from Google Calendar API via per-user Clerk token. */
async function fetchLiveCalendarMeetings(
  startDate: Date,
  endDate: Date,
  accessToken: string,
  minAttendees: number
): Promise<MeetingRow[]> {
  const events = await getAllEvents(
    startDate.toISOString(),
    endDate.toISOString(),
    { accessToken }
  );

  return events
    .map((e, i) => calendarEventToMeetingRow(e, i))
    .filter((m): m is MeetingRow => m !== null)
    .filter((m) => isWorkMeeting(m, minAttendees));
}

/** Convert a CalendarEvent from the Google API to a MeetingRow. */
function calendarEventToMeetingRow(
  event: CalendarEvent,
  index: number
): MeetingRow | null {
  const startTime = event.start.dateTime ?? event.start.date;
  const endTime = event.end.dateTime ?? event.end.date;
  if (!startTime || !endTime) return null;

  const attendees = event.attendees
    ? event.attendees.map((a) => ({
        email: a.email,
        name: a.displayName ?? null,
        responseStatus: a.responseStatus ?? null,
      }))
    : null;

  return {
    id: index,
    calendarEventId: event.id,
    title: event.summary ?? "(No title)",
    description: event.description ?? null,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    location: event.location ?? null,
    organizer: event.organizer?.displayName ?? event.organizer?.email ?? null,
    attendees,
    recurringEventId: event.recurringEventId ?? null,
    htmlLink: event.htmlLink ?? null,
  };
}

/**
 * Get meetings and pre-reads for a date range, with linking.
 * Pre-reads posted on day D are matched to meetings on day D or D+1.
 *
 * Requires an accessToken from Clerk's Google OAuth to fetch calendar events.
 * If no token provided, returns days with only pre-reads (no calendar events).
 */
export async function getMeetingsForRange(
  startDate: Date,
  endDate: Date,
  opts: { minAttendees?: number; accessToken?: string; userId?: string } = {}
): Promise<MeetingsRangeResult> {
  const minAttendees = opts.minAttendees ?? 2;

  // Fetch pre-reads from 1 day before the range start (they may link to day 1 meetings)
  const preReadStart = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);

  // Catch a 401 from Google Calendar so an expired-but-cached Clerk token
  // degrades to "reconnect" UX instead of crashing the whole page.
  let calendarAuthExpired = false;
  const loadCalendarMeetings = async (): Promise<MeetingRow[]> => {
    if (!opts.accessToken) return [];
    try {
      return await fetchLiveCalendarMeetings(
        startDate,
        endDate,
        opts.accessToken,
        minAttendees
      );
    } catch (error) {
      if (error instanceof CalendarAuthError) {
        console.error(
          "[meetings] Google Calendar auth failure — token rejected or missing scope, prompting reconnect",
          { userId: opts.userId, message: error.message }
        );
        calendarAuthExpired = true;
        return [];
      }
      throw error;
    }
  };

  // Fetch meetings, pre-reads, and Granola notes in parallel
  const [serializedMeetings, preReadRows, noteRows] = await Promise.all([
    loadCalendarMeetings(),
    withDbErrorContext("load meeting pre-reads", () =>
      db
        .select()
        .from(preReads)
        .where(
          and(
            gte(preReads.postedAt, preReadStart),
            lte(preReads.postedAt, endDate)
          )
        )
        .orderBy(desc(preReads.postedAt))
    ),
    withDbErrorContext("load meeting notes", () =>
      db
        .select()
        .from(meetingNotes)
        .where(
          and(
            gte(meetingNotes.meetingDate, startDate),
            lte(meetingNotes.meetingDate, endDate),
            // Only show notes owned by this user or enterprise (null)
            opts.userId
              ? or(
                  eq(meetingNotes.syncedByUserId, opts.userId),
                  isNull(meetingNotes.syncedByUserId)
                )
              : isNull(meetingNotes.syncedByUserId)
          )
        )
        .orderBy(desc(meetingNotes.meetingDate))
    ),
  ]);

  const serializedPreReads: PreReadRow[] = preReadRows.map((p) => ({
    id: p.id,
    slackTs: p.slackTs,
    channelId: p.channelId,
    userId: p.userId,
    userName: p.userName,
    title: p.title,
    content: p.content,
    postedAt: p.postedAt.toISOString(),
  }));

  // Group meetings by day
  const meetingsByDay = new Map<string, MeetingRow[]>();
  for (const m of serializedMeetings) {
    const day = m.startTime.slice(0, 10);
    const list = meetingsByDay.get(day) ?? [];
    list.push(m);
    meetingsByDay.set(day, list);
  }

  // Build keyword index for meetings
  const meetingKeywords = new Map<number, string[]>();
  for (const m of serializedMeetings) {
    meetingKeywords.set(m.id, extractKeywords(m.title));
  }

  // Link pre-reads to meetings
  const linkedPreReadIds = new Set<number>();
  const meetingPreReads = new Map<number, PreReadRow[]>();

  for (const pr of serializedPreReads) {
    const prDate = pr.postedAt.slice(0, 10);
    // Pre-reads can link to meetings on same day or next day
    const nextDay = new Date(new Date(prDate).getTime() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const candidateDays = [prDate, nextDay];

    let bestMatch: { meetingId: number; score: number } | null = null;

    for (const day of candidateDays) {
      const dayMeetings = meetingsByDay.get(day) ?? [];
      for (const m of dayMeetings) {
        const keywords = meetingKeywords.get(m.id) ?? [];
        const score = matchScore(pr.content ?? pr.title ?? "", keywords);
        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { meetingId: m.id, score };
        }
      }
    }

    if (bestMatch) {
      linkedPreReadIds.add(pr.id);
      const list = meetingPreReads.get(bestMatch.meetingId) ?? [];
      list.push(pr);
      meetingPreReads.set(bestMatch.meetingId, list);
    }
  }

  // Serialize and match Granola notes to meetings
  function serializeNote(n: typeof noteRows[number], isHistorical: boolean): MeetingNoteRow {
    return {
      id: n.id,
      granolaMeetingId: n.granolaMeetingId,
      title: n.title,
      summary: n.summary,
      transcript: n.transcript,
      participants: n.participants as MeetingNoteRow["participants"],
      meetingDate: n.meetingDate.toISOString(),
      calendarEventId: n.calendarEventId,
      isHistorical,
    };
  }

  const serializedNotes = noteRows.map((n) => serializeNote(n, false));

  // Build a calendar event ID index for meetings
  const meetingByEventId = new Map<string, MeetingRow>();
  for (const m of serializedMeetings) {
    meetingByEventId.set(m.calendarEventId, m);
  }

  // Build a recurring base ID index for meetings.
  // Google Calendar recurringEventId can include a _R suffix (e.g.
  // "baseId_R20251030T133000") when the series was modified. Individual
  // instance IDs use "baseId_YYYYMMDDTHHMMSSZ". We strip the _R suffix
  // so the LIKE query matches instance IDs correctly.
  const meetingsByRecurringBase = new Map<string, MeetingRow[]>();
  for (const m of serializedMeetings) {
    if (m.recurringEventId) {
      const baseId = m.recurringEventId.replace(/_R\d{8}T\d{6}$/, "");
      const list = meetingsByRecurringBase.get(baseId) ?? [];
      list.push(m);
      meetingsByRecurringBase.set(baseId, list);
    }
  }

  // Build a title index for title-based historical note matching (fallback
  // for meetings without recurringEventId).
  const meetingsByTitle = new Map<string, MeetingRow[]>();
  for (const m of serializedMeetings) {
    if (!m.recurringEventId && m.title) {
      const key = m.title.toLowerCase().trim();
      const list = meetingsByTitle.get(key) ?? [];
      list.push(m);
      meetingsByTitle.set(key, list);
    }
  }

  // Match notes to meetings: calendar event ID (primary), then attendee overlap (fallback)
  const meetingNotesMap = new Map<number, MeetingNoteRow[]>();
  const matchedNoteIds = new Set<number>();

  for (const note of serializedNotes) {
    // Tier 1: exact calendar event ID match
    if (note.calendarEventId) {
      const meeting = meetingByEventId.get(note.calendarEventId);
      if (meeting) {
        const list = meetingNotesMap.get(meeting.id) ?? [];
        list.push(note);
        meetingNotesMap.set(meeting.id, list);
        matchedNoteIds.add(note.id);
        continue;
      }
    }

    // Tier 2: attendee overlap + same day fallback
    const noteDate = note.meetingDate.slice(0, 10);
    const noteEmails = new Set(
      (note.participants ?? []).map((p) => p.email?.toLowerCase()).filter(Boolean)
    );
    if (noteEmails.size > 0) {
      let bestMatch: { meetingId: number; overlap: number } | null = null;
      const dayMeetings = meetingsByDay.get(noteDate) ?? [];
      for (const m of dayMeetings) {
        if (!m.attendees) continue;
        const overlap = m.attendees.filter(
          (a) => a.email && noteEmails.has(a.email.toLowerCase())
        ).length;
        if (overlap >= 2 && (!bestMatch || overlap > bestMatch.overlap)) {
          bestMatch = { meetingId: m.id, overlap };
        }
      }
      if (bestMatch) {
        const list = meetingNotesMap.get(bestMatch.meetingId) ?? [];
        list.push(note);
        meetingNotesMap.set(bestMatch.meetingId, list);
        matchedNoteIds.add(note.id);
      }
    }
  }

  // Fetch historical notes for recurring meetings (by calendar event ID prefix)
  const recurringBaseIds = [...meetingsByRecurringBase.keys()];
  if (recurringBaseIds.length > 0) {
    const likeConditions = recurringBaseIds.map((baseId) =>
      like(meetingNotes.calendarEventId, `${baseId}%`)
    );
    const historicalRows = await withDbErrorContext(
      "load historical meeting notes",
      () =>
        db
          .select()
          .from(meetingNotes)
          .where(
            and(
              or(...likeConditions),
              lte(meetingNotes.meetingDate, startDate), // only past notes
              opts.userId
                ? or(
                    eq(meetingNotes.syncedByUserId, opts.userId),
                    isNull(meetingNotes.syncedByUserId)
                  )
                : isNull(meetingNotes.syncedByUserId)
            )
          )
          .orderBy(desc(meetingNotes.meetingDate))
    );

    for (const row of historicalRows) {
      if (!row.calendarEventId) continue;
      const baseId = recurringBaseIds.find((id) =>
        row.calendarEventId!.startsWith(id)
      );
      if (!baseId) continue;
      const recurringMeetings = meetingsByRecurringBase.get(baseId) ?? [];
      for (const m of recurringMeetings) {
        const list = meetingNotesMap.get(m.id) ?? [];
        if (list.some((n) => n.id === row.id)) continue;
        list.push(serializeNote(row, true));
        meetingNotesMap.set(m.id, list);
      }
    }
  }

  // Fetch historical notes by title match (fallback for non-recurring meetings)
  const titleKeys = [...meetingsByTitle.keys()];
  if (titleKeys.length > 0) {
    const titleConditions = titleKeys.map((t) =>
      sql`LOWER(TRIM(${meetingNotes.title})) = ${t}`
    );
    const titleMatchRows = await withDbErrorContext(
      "load meeting notes by title",
      () =>
        db
          .select()
          .from(meetingNotes)
          .where(
            and(
              or(...titleConditions),
              lte(meetingNotes.meetingDate, startDate),
              opts.userId
                ? or(
                    eq(meetingNotes.syncedByUserId, opts.userId),
                    isNull(meetingNotes.syncedByUserId)
                  )
                : isNull(meetingNotes.syncedByUserId)
            )
          )
          .orderBy(desc(meetingNotes.meetingDate))
          .limit(50)
    );

    for (const row of titleMatchRows) {
      const key = (row.title ?? "").toLowerCase().trim();
      const meetings = meetingsByTitle.get(key) ?? [];
      for (const m of meetings) {
        const list = meetingNotesMap.get(m.id) ?? [];
        if (list.some((n) => n.id === row.id)) continue;
        list.push(serializeNote(row, true));
        meetingNotesMap.set(m.id, list);
      }
    }
  }

  // Sort notes per meeting: current first, then historical by date desc
  for (const [id, notes] of meetingNotesMap) {
    notes.sort((a, b) => {
      if (a.isHistorical !== b.isHistorical) return a.isHistorical ? 1 : -1;
      return b.meetingDate.localeCompare(a.meetingDate);
    });
    meetingNotesMap.set(id, notes);
  }

  // Build day data for each day in the range (always Mon-Fri)
  const days: DayData[] = [];
  const cursor = new Date(startDate);
  for (let i = 0; i < 5; i++) {
    const dayStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const dayMeetings = meetingsByDay.get(dayStr) ?? [];

    const linkedMeetings: LinkedMeeting[] = dayMeetings.map((m) => ({
      ...m,
      preReads: meetingPreReads.get(m.id) ?? [],
      notes: meetingNotesMap.get(m.id) ?? [],
    }));

    // Unlinked pre-reads posted on this day
    const unlinked = serializedPreReads.filter(
      (pr) => pr.postedAt.slice(0, 10) === dayStr && !linkedPreReadIds.has(pr.id)
    );

    // Notes for this day that didn't match any meeting
    const linkedNoteIds = new Set(
      [...meetingNotesMap.values()].flat().map((n) => n.id)
    );
    const unlinkedNotes = serializedNotes.filter(
      (n) => n.meetingDate.slice(0, 10) === dayStr && !linkedNoteIds.has(n.id)
    );

    days.push({
      date: dayStr,
      meetings: linkedMeetings,
      unlinkedPreReads: unlinked,
      unlinkedNotes,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return { days, calendarAuthExpired };
}

/**
 * Get the start of the current week (Monday).
 */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the week (Friday EOD).
 */
export function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 4); // Friday
  d.setHours(23, 59, 59, 999);
  return d;
}
