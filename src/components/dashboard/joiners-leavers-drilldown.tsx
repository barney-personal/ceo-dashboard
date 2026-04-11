"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, MapPin, Mail, Briefcase, Calendar, UserIcon } from "lucide-react";
import { DivergingBarChart, type DivergingBarData } from "@/components/charts/diverging-bar-chart";

export interface MovementPerson {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  function: string;
  squad: string;
  location: string;
  startDate: string;
  terminationDate: string;
  monthKey: string;
}

interface JoinersLeaversDrilldownProps {
  chartData: DivergingBarData[];
  joiners: MovementPerson[];
  departures: MovementPerson[];
  modeUrl?: string;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function JoinersLeaversDrilldown({
  chartData,
  joiners,
  departures,
  modeUrl,
}: JoinersLeaversDrilldownProps) {
  const [selection, setSelection] = useState<{
    monthKey: string;
    date: string;
    type: "positive" | "negative";
  } | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<MovementPerson | null>(null);

  const people = useMemo(() => {
    if (!selection) return [];
    const source = selection.type === "positive" ? joiners : departures;
    return source
      .filter((p) => p.monthKey === selection.monthKey)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selection, joiners, departures]);

  const backButton = (onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 rounded-md border border-border/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <ChevronLeft className="h-3 w-3" />
      Back
    </button>
  );

  // Level 3: person detail
  if (selectedPerson) {
    const isLeaver = selection?.type === "negative";
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          {backButton(() => setSelectedPerson(null))}
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {selectedPerson.name}
            </h3>
            {selectedPerson.jobTitle && (
              <p className="text-xs text-muted-foreground">
                {[selectedPerson.jobTitle, selectedPerson.level].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {selectedPerson.email && (
            <div className="flex items-start gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Email</p>
                <p className="text-sm text-foreground">{selectedPerson.email}</p>
              </div>
            </div>
          )}
          {selectedPerson.level && (
            <div className="flex items-start gap-2.5">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Level</p>
                <p className="text-sm text-foreground">{selectedPerson.level}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Function</p>
              <p className="text-sm text-foreground">{selectedPerson.function}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Squad</p>
              <p className="text-sm text-foreground">{selectedPerson.squad}</p>
            </div>
          </div>
          {selectedPerson.location && (
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Location</p>
                <p className="text-sm text-foreground">{selectedPerson.location}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2.5">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Start Date</p>
              <p className="text-sm text-foreground">{formatDate(selectedPerson.startDate)}</p>
            </div>
          </div>
          {isLeaver && selectedPerson.terminationDate && (
            <div className="flex items-start gap-2.5">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Departure Date</p>
                <p className="text-sm text-foreground">{formatDate(selectedPerson.terminationDate)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Level 2: people list for selected month
  if (selection) {
    const label = selection.type === "positive" ? "Joiners" : "Departures";
    const color = selection.type === "positive" ? "text-positive" : "text-destructive";

    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          {backButton(() => { setSelection(null); setSelectedPerson(null); })}
          <div>
            <h3 className="text-base font-semibold text-foreground">
              <span className={color}>{label}</span>
              {" — "}
              {formatMonthLabel(selection.date)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {people.length} {people.length === 1 ? "person" : "people"}
            </p>
          </div>
        </div>
        {people.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-sm text-muted-foreground">No records found for this month.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {people.map((person) => (
              <button
                key={person.email || person.name}
                onClick={() => setSelectedPerson(person)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {person.name}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {[person.jobTitle, person.level].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground/60 md:block">
                  {person.function}
                </span>
                {person.location && (
                  <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/60 lg:flex">
                    <MapPin className="h-2.5 w-2.5" />
                    {person.location}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                  {formatDate(selection.type === "positive" ? person.startDate : person.terminationDate)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Level 1: chart
  return (
    <DivergingBarChart
      data={chartData}
      title="Joiners & Departures"
      subtitle="last 3 years, monthly"
      modeUrl={modeUrl}
      onBarClick={(item) => {
        const d = new Date(item.date);
        const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        setSelection({ monthKey, date: item.date, type: item.type });
      }}
    />
  );
}
