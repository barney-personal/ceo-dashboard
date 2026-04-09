"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DayData } from "@/lib/data/meetings";
import {
  ArrowUpRight,
  Calendar,
  Clock,
  Users,
  FileText,
  ExternalLink,
} from "lucide-react";

function extractLinks(text: string): { url: string; label: string }[] {
  const links: { url: string; label: string }[] = [];
  const slackLinkRe = /<(https?:\/\/[^|>]+)\|?([^>]*)>/g;
  let match;
  while ((match = slackLinkRe.exec(text)) !== null) {
    links.push({ url: match[1], label: match[2] || new URL(match[1]).hostname });
  }
  return links;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface TodayMeetingsProps {
  day: DayData | null;
  calendarConnected: boolean;
}

export function TodayMeetings({ day, calendarConnected }: TodayMeetingsProps) {
  const meetings = day?.meetings ?? [];
  const unlinkedPreReads = day?.unlinkedPreReads ?? [];
  const totalPreReads =
    meetings.reduce((sum, m) => sum + m.preReads.length, 0) +
    unlinkedPreReads.length;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Today&apos;s Meetings
            </h3>
            {meetings.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {meetings.length} meeting{meetings.length !== 1 && "s"}
                {totalPreReads > 0 && ` · ${totalPreReads} pre-read${totalPreReads !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
        </div>
        <Link
          href="/dashboard/meetings"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Full week
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="px-5 py-4">
        {!calendarConnected ? (
          <div className="flex items-center gap-3 rounded-lg bg-amber-50/50 px-3 py-2.5">
            <Calendar className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-700">
              Sign out and back in to connect your Google Calendar.
            </p>
          </div>
        ) : meetings.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground/60">
            No meetings today
          </p>
        ) : (
          <div className="space-y-2">
            {meetings.map((m) => {
              const preReadLinks = m.preReads.flatMap((pr) =>
                extractLinks(pr.content ?? "")
              );

              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-border/40 px-3 py-2",
                    m.preReads.length > 0 && "border-l-2 border-l-primary/40"
                  )}
                >
                  <div className="mt-0.5 flex flex-col items-center">
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {formatTime(m.startTime)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.title}
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {Array.isArray(m.attendees) && m.attendees.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {m.attendees.length}
                        </span>
                      )}
                      {m.htmlLink && (
                        <a
                          href={m.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 hover:text-foreground"
                        >
                          <Clock className="h-2.5 w-2.5" />
                          Open
                        </a>
                      )}
                    </div>
                    {preReadLinks.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {preReadLinks.map((link, i) => (
                          <a
                            key={i}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            <FileText className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{link.label}</span>
                            <ExternalLink className="h-2 w-2 shrink-0" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {unlinkedPreReads.length > 0 && (
              <div className="mt-1 border-t border-dashed border-border/30 pt-2">
                <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                  Other pre-reads
                </span>
                {unlinkedPreReads.map((pr) => {
                  const links = extractLinks(pr.content ?? "");
                  const mainLink = links[0];
                  if (!mainLink) return null;
                  return (
                    <a
                      key={pr.id}
                      href={mainLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 text-[10px] text-primary hover:underline"
                    >
                      <FileText className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{mainLink.label}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
