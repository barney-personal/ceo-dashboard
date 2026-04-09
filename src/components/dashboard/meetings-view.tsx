"use client";

import { useState, useCallback, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { DayData, LinkedMeeting, PreReadRow } from "@/lib/data/meetings";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
  FileText,
  ExternalLink,
  MapPin,
  CalendarDays,
  LayoutList,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  );
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatWeekLabel(startDate: string, endDate: string): string {
  const s = new Date(startDate + "T12:00:00");
  const e = new Date(endDate + "T12:00:00");
  const sMonth = s.toLocaleDateString("en-GB", { month: "short" });
  const eMonth = e.toLocaleDateString("en-GB", { month: "short" });
  const year = s.getFullYear();
  if (sMonth === eMonth) {
    return `${s.getDate()} – ${e.getDate()} ${sMonth} ${year}`;
  }
  return `${s.getDate()} ${sMonth} – ${e.getDate()} ${eMonth} ${year}`;
}

function extractLinks(text: string): { url: string; label: string }[] {
  const links: { url: string; label: string }[] = [];
  const slackLinkRe = /<(https?:\/\/[^|>]+)\|?([^>]*)>/g;
  let match;
  while ((match = slackLinkRe.exec(text)) !== null) {
    links.push({ url: match[1], label: match[2] || new URL(match[1]).hostname });
  }
  return links;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === localToday();
}

function offsetWeek(weekStart: string, delta: number): string {
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() + 7 * delta);
  return d.toISOString().slice(0, 10);
}

/** Get the Monday of the current week */
function currentWeekMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PreReadCard({ preRead }: { preRead: PreReadRow }) {
  const links = extractLinks(preRead.content ?? "");
  const mainLink = links[0];

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {preRead.userName && (
            <span className="text-xs font-medium text-foreground">
              {preRead.userName}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {formatTime(preRead.postedAt)}
          </span>
        </div>
        {mainLink ? (
          <a
            href={mainLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <span className="truncate">{mainLink.label}</span>
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          </a>
        ) : (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {preRead.title || preRead.content?.slice(0, 80)}
          </p>
        )}
      </div>
    </div>
  );
}

function CompactPreReadLink({ preRead }: { preRead: PreReadRow }) {
  const links = extractLinks(preRead.content ?? "");
  const mainLink = links[0];
  if (!mainLink) return null;

  return (
    <a
      href={mainLink.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 text-[10px] text-primary hover:underline"
    >
      <FileText className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{mainLink.label}</span>
    </a>
  );
}

function MeetingCard({
  meeting,
  expanded,
  onToggle,
}: {
  meeting: LinkedMeeting;
  expanded: boolean;
  onToggle: () => void;
}) {
  const attendeeCount = Array.isArray(meeting.attendees)
    ? meeting.attendees.length
    : 0;
  const hasPreReads = meeting.preReads.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card shadow-warm transition-all duration-150",
        expanded && "ring-1 ring-primary/20"
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div className="mt-0.5 flex flex-col items-center">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatTime(meeting.startTime)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatDuration(meeting.startTime, meeting.endTime)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {meeting.title}
            </span>
            {hasPreReads && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                {meeting.preReads.length}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            {attendeeCount > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {attendeeCount}
              </span>
            )}
            {meeting.location && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" />
                {meeting.location}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3">
          {meeting.description && (
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {meeting.description.slice(0, 300)}
              {meeting.description.length > 300 && "..."}
            </p>
          )}

          {meeting.preReads.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Pre-reads
              </span>
              {meeting.preReads.map((pr) => (
                <PreReadCard key={pr.id} preRead={pr} />
              ))}
            </div>
          )}

          {meeting.htmlLink && (
            <a
              href={meeting.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-primary"
            >
              Open in Google Calendar
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DayColumn({
  day,
  isExpanded,
  expandedMeetingId,
  onToggleMeeting,
  onSelectDay,
}: {
  day: DayData;
  isExpanded: boolean;
  expandedMeetingId: number | null;
  onToggleMeeting: (id: number) => void;
  onSelectDay?: () => void;
}) {
  const totalPreReads =
    day.meetings.reduce((sum, m) => sum + m.preReads.length, 0) +
    day.unlinkedPreReads.length;

  const today = isToday(day.date);

  if (!isExpanded) {
    return (
      <div
        className={cn(
          "flex-1 rounded-xl border px-2 pb-3 pt-1",
          today
            ? "border-primary/30 bg-primary/[0.03]"
            : "border-transparent"
        )}
      >
        <button
          onClick={onSelectDay}
          className="mb-2 flex w-full items-center justify-between rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
        >
          <div className="flex items-center gap-1.5">
            {today && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            <span
              className={cn(
                "text-xs font-semibold",
                today ? "text-primary" : "text-foreground"
              )}
            >
              {formatDayLabel(day.date)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {day.meetings.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {day.meetings.length}
              </span>
            )}
            {totalPreReads > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-primary">
                <FileText className="h-2.5 w-2.5" />
                {totalPreReads}
              </span>
            )}
          </div>
        </button>
        <div className="space-y-1.5 px-0.5">
          {day.meetings.map((m) => {
            const preReadLinks = m.preReads.flatMap((pr) =>
              extractLinks(pr.content ?? "")
            );

            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg border border-border/40 bg-card px-2.5 py-1.5",
                  m.preReads.length > 0 && "border-l-2 border-l-primary/40"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                    {formatTime(m.startTime)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                  {m.title}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {Array.isArray(m.attendees) && m.attendees.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Users className="h-2.5 w-2.5" />
                      {m.attendees.length}
                    </span>
                  )}
                </div>
                {preReadLinks.length > 0 && (
                  <div className="mt-1.5 space-y-1 border-t border-border/30 pt-1.5">
                    {preReadLinks.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        <FileText className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{link.label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {day.meetings.length === 0 && (
            <p className="px-2 py-4 text-center text-[10px] text-muted-foreground/50">
              No meetings
            </p>
          )}
          {day.unlinkedPreReads.length > 0 && (
            <div className="mt-1 space-y-1 border-t border-dashed border-border/30 pt-1.5">
              <span className="px-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                Other pre-reads
              </span>
              {day.unlinkedPreReads.map((pr) => (
                <CompactPreReadLink key={pr.id} preRead={pr} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Expanded day view
  return (
    <div className="flex-1">
      <div
        className={cn(
          "mb-3 rounded-lg px-2 py-1.5",
          today && "bg-primary/5"
        )}
      >
        <div className="flex items-center gap-1.5">
          {today && (
            <span className="h-2 w-2 rounded-full bg-primary" />
          )}
          <span
            className={cn(
              "text-sm font-semibold",
              today ? "text-primary" : "text-foreground"
            )}
          >
            {formatDayLabel(day.date)}
          </span>
        </div>
        <span className="ml-3.5 text-xs text-muted-foreground">
          {day.meetings.length} meeting{day.meetings.length !== 1 && "s"}
          {totalPreReads > 0 && ` · ${totalPreReads} pre-read${totalPreReads !== 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="space-y-2">
        {day.meetings.map((m) => (
          <MeetingCard
            key={m.id}
            meeting={m}
            expanded={expandedMeetingId === m.id}
            onToggle={() => onToggleMeeting(m.id)}
          />
        ))}
        {day.meetings.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/40 p-6 text-center">
            <p className="text-xs text-muted-foreground/50">No meetings</p>
          </div>
        )}
      </div>

      {day.unlinkedPreReads.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Other pre-reads
          </span>
          {day.unlinkedPreReads.map((pr) => (
            <PreReadCard key={pr.id} preRead={pr} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ViewMode = "week" | "day";

interface MeetingsViewProps {
  initialDays: DayData[];
  initialWeekStart: string; // YYYY-MM-DD
  calendarConnected?: boolean;
}

export function MeetingsView({ initialDays, initialWeekStart, calendarConnected = true }: MeetingsViewProps) {
  const [days, setDays] = useState(initialDays);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [isPending, startTransition] = useTransition();
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const todayStr = localToday();
    const idx = initialDays.findIndex((d) => d.date === todayStr);
    return idx >= 0 ? idx : 0;
  });
  const [expandedMeetingId, setExpandedMeetingId] = useState<number | null>(null);

  const weekEnd = days[days.length - 1]?.date ?? weekStart;

  const totalMeetings = days.reduce((sum, d) => sum + d.meetings.length, 0);
  const totalPreReads = days.reduce(
    (sum, d) =>
      sum +
      d.meetings.reduce((s, m) => s + m.preReads.length, 0) +
      d.unlinkedPreReads.length,
    0
  );
  const linkedCount = days.reduce(
    (sum, d) => sum + d.meetings.filter((m) => m.preReads.length > 0).length,
    0
  );

  const isCurrentWeek = weekStart === currentWeekMonday();

  const fetchWeek = useCallback(async (newWeekStart: string) => {
    const res = await fetch(`/api/meetings?week=${newWeekStart}`);
    if (!res.ok) return;
    const data = (await res.json()) as { days: DayData[]; weekStart: string };
    setDays(data.days);
    setWeekStart(data.weekStart);
    setExpandedMeetingId(null);
    // Reset day index to today if visible, otherwise first day
    const todayStr = localToday();
    const idx = data.days.findIndex((d) => d.date === todayStr);
    setSelectedDayIndex(idx >= 0 ? idx : 0);
  }, []);

  const navigateWeek = (delta: number) => {
    const newWeek = offsetWeek(weekStart, delta);
    startTransition(() => {
      void fetchWeek(newWeek);
    });
  };

  const goToThisWeek = () => {
    const thisMonday = currentWeekMonday();
    startTransition(() => {
      void fetchWeek(thisMonday);
    });
  };

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card p-0.5 shadow-warm">
            <button
              onClick={() => setViewMode("week")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "week"
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Week
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "day"
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              Day
            </button>
          </div>

          {/* Today button — always visible, disabled on current week */}
          <button
            onClick={goToThisWeek}
            disabled={isCurrentWeek}
            className={cn(
              "rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium transition-colors",
              isCurrentWeek
                ? "cursor-default border-transparent text-muted-foreground/40"
                : "bg-card text-foreground shadow-warm hover:bg-muted/50"
            )}
          >
            Today
          </button>

          {/* Week navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateWeek(-1)}
              disabled={isPending}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex min-w-[160px] items-center justify-center gap-2 text-center text-sm font-semibold text-foreground">
              {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {viewMode === "week"
                ? formatWeekLabel(weekStart, weekEnd)
                : formatDayLabel(days[selectedDayIndex]?.date ?? weekStart)}
            </span>
            <button
              onClick={() => navigateWeek(1)}
              disabled={isPending}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {viewMode === "day" && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDayIndex((i) => Math.max(0, i - 1))}
              disabled={selectedDayIndex === 0}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() =>
                setSelectedDayIndex((i) => Math.min(days.length - 1, i + 1))
              }
              disabled={selectedDayIndex === days.length - 1}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Connect calendar prompt */}
      {!calendarConnected && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              Connect your Google Calendar
            </p>
            <p className="text-xs text-amber-700/80">
              Sign out and back in to grant calendar access, then your personal meetings will appear here.
            </p>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{totalMeetings}</strong> meetings
        </span>
        <span>
          <strong className="text-foreground">{totalPreReads}</strong> pre-reads
        </span>
        <span>
          <strong className="text-foreground">{linkedCount}</strong> with pre-reads
        </span>
      </div>

      {/* Content */}
      <div className={cn(isPending && "opacity-60 transition-opacity")}>
        {viewMode === "week" ? (
          <div className="flex gap-2">
            {days.map((day, i) => (
              <DayColumn
                key={day.date}
                day={day}
                isExpanded={false}
                expandedMeetingId={null}
                onToggleMeeting={() => {}}
                onSelectDay={() => {
                  setSelectedDayIndex(i);
                  setViewMode("day");
                }}
              />
            ))}
          </div>
        ) : (
          <DayColumn
            day={days[selectedDayIndex] ?? days[0]}
            isExpanded={true}
            expandedMeetingId={expandedMeetingId}
            onToggleMeeting={(id) =>
              setExpandedMeetingId((prev) => (prev === id ? null : id))
            }
          />
        )}
      </div>
    </div>
  );
}
