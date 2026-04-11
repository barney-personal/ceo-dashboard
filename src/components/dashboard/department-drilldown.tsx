"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, MapPin, Mail, Users, Briefcase, Calendar, Clock, UserIcon } from "lucide-react";
import { BarChart, type BarChartData } from "@/components/charts/bar-chart";

export interface DrilldownPerson {
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

interface DepartmentDrilldownProps {
  employees: DrilldownPerson[];
  total: number;
  modeUrl?: string;
}

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

export function DepartmentDrilldown({
  employees,
  total,
  modeUrl,
}: DepartmentDrilldownProps) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<DrilldownPerson | null>(null);

  // Derive department bars from the same employees array used for drilldown,
  // so labels always match and fallback-path divergence can't cause mismatches.
  const deptData: BarChartData[] = useMemo(() => {
    const byDept = new Map<string, number>();
    for (const e of employees) {
      const dept = e.function || "Unknown";
      byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
    }
    return [...byDept.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: "#3b3bba" }));
  }, [employees]);

  const jobTitleData = useMemo(() => {
    if (!selectedDept) return [];
    const deptEmployees = employees.filter(
      (e) => e.function === selectedDept
    );
    // Group by normalised key but display the most common original casing
    const counts = new Map<string, { display: string; count: number }>();
    for (const e of deptEmployees) {
      const raw = e.jobTitle.trim() || "Untitled";
      const key = raw.toLowerCase();
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { display: raw, count: 1 });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ display, count }) => ({ label: display, value: count, color: "#3b3bba" }));
  }, [selectedDept, employees]);

  const levelData = useMemo(() => {
    if (!selectedDept || !selectedTitle) return [];
    const filtered = employees.filter(
      (e) =>
        e.function === selectedDept &&
        (e.jobTitle.trim() || "Untitled").toLowerCase() === selectedTitle.toLowerCase()
    );
    const counts = new Map<string, number>();
    for (const e of filtered) {
      const level = e.level.trim() || "Unspecified";
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value, color: "#3b3bba" }));
  }, [selectedDept, selectedTitle, employees]);

  const levelPeople = useMemo(() => {
    if (!selectedDept || !selectedTitle || !selectedLevel) return [];
    return employees
      .filter(
        (e) =>
          e.function === selectedDept &&
          (e.jobTitle.trim() || "Untitled").toLowerCase() === selectedTitle.toLowerCase() &&
          (e.level.trim() || "Unspecified") === selectedLevel
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedDept, selectedTitle, selectedLevel, employees]);

  const backButton = (onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 rounded-md border border-border/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <ChevronLeft className="h-3 w-3" />
      Back
    </button>
  );

  // Level 5: person detail
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
          {selectedPerson.employmentType && (
            <div className="flex items-start gap-2.5">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Employment Type</p>
                <p className="text-sm text-foreground">{selectedPerson.employmentType}</p>
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

  // Level 4: employee list for a specific level
  if (selectedDept && selectedTitle && selectedLevel) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-warm">
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          {backButton(() => setSelectedLevel(null))}
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {selectedTitle} · {selectedLevel}
            </h3>
            <p className="text-xs text-muted-foreground">
              {levelPeople.length} in {selectedDept}
            </p>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          {levelPeople.map((person) => (
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
                  {person.squad}
                </span>
              </div>
              {person.location && (
                <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/60 md:flex">
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

  // Level 3: level distribution for a specific job title
  if (selectedDept && selectedTitle) {
    const titleCount = employees.filter(
      (e) =>
        e.function === selectedDept &&
        (e.jobTitle.trim() || "Untitled").toLowerCase() === selectedTitle.toLowerCase()
    ).length;

    return (
      <BarChart
        data={levelData}
        title={selectedTitle}
        subtitle={`${titleCount} in ${selectedDept}`}
        modeUrl={modeUrl}
        headerLeft={backButton(() => { setSelectedTitle(null); setSelectedLevel(null); })}
        onBarClick={(item) => setSelectedLevel(item.label)}
      />
    );
  }

  // Level 2: job titles within a department
  if (selectedDept) {
    const deptCount = employees.filter((e) => e.function === selectedDept).length;

    return (
      <BarChart
        data={jobTitleData}
        title={selectedDept}
        subtitle={`${deptCount} employees`}
        modeUrl={modeUrl}
        leftMargin={220}
        headerLeft={backButton(() => { setSelectedDept(null); setSelectedTitle(null); setSelectedLevel(null); })}
        onBarClick={(item) => setSelectedTitle(item.label)}
      />
    );
  }

  // Level 1: departments
  return (
    <BarChart
      data={deptData}
      title="Headcount by Department"
      subtitle={`${total} total`}
      modeUrl={modeUrl}
      onBarClick={(item) => setSelectedDept(item.label)}
    />
  );
}
