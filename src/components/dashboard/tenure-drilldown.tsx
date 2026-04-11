"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, MapPin, Mail, Users, Briefcase, Calendar, Clock, UserIcon } from "lucide-react";
import { BarChart, type BarChartData } from "@/components/charts/bar-chart";

interface TenurePerson {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  function: string;
  squad: string;
  pillar: string;
  manager: string;
  startDate: string;
  location: string;
  tenureMonths: number;
  employmentType: string;
}

interface TenureDrilldownProps {
  data: BarChartData[];
  employees: TenurePerson[];
  total: number;
  modeUrl?: string;
}

const TENURE_BUCKETS = [
  { label: "< 6 months", min: 0, max: 6 },
  { label: "6–12 months", min: 6, max: 12 },
  { label: "1–2 years", min: 12, max: 24 },
  { label: "2–3 years", min: 24, max: 36 },
  { label: "3–5 years", min: 36, max: 60 },
  { label: "5+ years", min: 60, max: Infinity },
];

function formatTenure(months: number): string {
  if (months < 1) return "< 1mo";
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (remaining === 0) return `${years}y`;
  return `${years}y ${remaining}mo`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function TenureDrilldown({ data, employees, total, modeUrl }: TenureDrilldownProps) {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<TenurePerson | null>(null);

  const bucketPeople = useMemo(() => {
    if (!selectedBucket) return [];
    const bucket = TENURE_BUCKETS.find((b) => b.label === selectedBucket);
    if (!bucket) return [];
    return employees
      .filter((p) => p.tenureMonths >= bucket.min && p.tenureMonths < bucket.max)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedBucket, employees]);

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
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Squad</p>
              <p className="text-sm text-foreground">{selectedPerson.squad}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Pillar</p>
              <p className="text-sm text-foreground">{selectedPerson.pillar}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Function</p>
              <p className="text-sm text-foreground">{selectedPerson.function}</p>
            </div>
          </div>
          {selectedPerson.manager && (
            <div className="flex items-start gap-2.5">
              <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Manager</p>
                <p className="text-sm text-foreground">{selectedPerson.manager}</p>
              </div>
            </div>
          )}
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
          <div className="flex items-start gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Tenure</p>
              <p className="text-sm text-foreground">{formatTenure(selectedPerson.tenureMonths)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Level 2: employee list for a tenure bucket
  if (selectedBucket) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          {backButton(() => { setSelectedBucket(null); setSelectedPerson(null); })}
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {selectedBucket}
            </h3>
            <p className="text-xs text-muted-foreground">
              {bucketPeople.length} {bucketPeople.length === 1 ? "employee" : "employees"}
            </p>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {bucketPeople.map((person) => (
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
                {formatTenure(person.tenureMonths)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Level 1: chart
  return (
    <BarChart
      data={data}
      title="Tenure Distribution"
      subtitle={`${total} employees`}
      modeUrl={modeUrl}
      onBarClick={(item) => setSelectedBucket(item.label)}
    />
  );
}
