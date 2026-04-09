import { db } from "@/lib/db";
import { meetingNotes, preReads } from "@/lib/db/schema";
import { and, gte, lte, desc } from "drizzle-orm";
import { getAllEvents, type CalendarEvent } from "@/lib/integrations/google-calendar";

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
  opts: { minAttendees?: number; accessToken?: string } = {}
): Promise<DayData[]> {
  const minAttendees = opts.minAttendees ?? 2;

  // Fetch pre-reads from 1 day before the range start (they may link to day 1 meetings)
  const preReadStart = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);

  // Fetch meetings, pre-reads, and Granola notes in parallel
  const [serializedMeetings, preReadRows, noteRows] = await Promise.all([
    opts.accessToken
      ? fetchLiveCalendarMeetings(startDate, endDate, opts.accessToken, minAttendees)
      : Promise.resolve([] as MeetingRow[]),
    db
      .select()
      .from(preReads)
      .where(
        and(
          gte(preReads.postedAt, preReadStart),
          lte(preReads.postedAt, endDate)
        )
      )
      .orderBy(desc(preReads.postedAt)),
    db
      .select()
      .from(meetingNotes)
      .where(
        and(
          gte(meetingNotes.meetingDate, startDate),
          lte(meetingNotes.meetingDate, endDate)
        )
      )
      .orderBy(desc(meetingNotes.meetingDate)),
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
  const serializedNotes: MeetingNoteRow[] = noteRows.map((n) => ({
    id: n.id,
    granolaMeetingId: n.granolaMeetingId,
    title: n.title,
    summary: n.summary,
    transcript: n.transcript,
    participants: n.participants as MeetingNoteRow["participants"],
    meetingDate: n.meetingDate.toISOString(),
  }));

  const meetingNotesMap = new Map<number, MeetingNoteRow[]>();
  for (const note of serializedNotes) {
    const noteDate = note.meetingDate.slice(0, 10);
    const noteKeywords = extractKeywords(note.title);
    const noteEmails = new Set(
      (note.participants ?? []).map((p) => p.email?.toLowerCase()).filter(Boolean)
    );

    let bestMatch: { meetingId: number; score: number } | null = null;
    const dayMeetings = meetingsByDay.get(noteDate) ?? [];

    for (const m of dayMeetings) {
      // Score by title keyword overlap
      let score = 0;
      const mKeywords = meetingKeywords.get(m.id) ?? [];
      for (const kw of noteKeywords) {
        if (mKeywords.includes(kw)) score++;
      }
      // Boost for attendee email overlap
      if (noteEmails.size > 0 && m.attendees) {
        const overlap = m.attendees.filter(
          (a) => a.email && noteEmails.has(a.email.toLowerCase())
        ).length;
        score += overlap * 0.5;
      }
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { meetingId: m.id, score };
      }
    }

    if (bestMatch) {
      const list = meetingNotesMap.get(bestMatch.meetingId) ?? [];
      list.push(note);
      meetingNotesMap.set(bestMatch.meetingId, list);
    }
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

  return days;
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
