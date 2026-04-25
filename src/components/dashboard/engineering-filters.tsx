"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { classifyDiscipline, type Discipline } from "@/lib/data/disciplines";

export interface EngineeringFilterState {
  roles: Set<string>;
  level: string;
  squad: string;
  tenureBuckets: Set<string>;
}

export const EMPTY_FILTERS: EngineeringFilterState = {
  roles: new Set(),
  level: "all",
  squad: "all",
  tenureBuckets: new Set(),
};

// Display labels for the shared `Discipline` enum from disciplines.ts.
// Single source of truth so the chip labels here don't drift from the
// server-side eligibility filter.
const DISCIPLINE_LABEL: Record<Discipline, string> = {
  BE: "Backend",
  FE: "Frontend",
  EM: "EM",
  QA: "QA",
  ML: "ML",
  Ops: "Ops",
  Other: "Other",
};

function categorizeRole(jobTitle: string | null): string {
  // jobTitle preserves the rp_specialisation "(M)" suffix where present,
  // so we pass it as the rpSpecialisation argument for accurate manager
  // detection — same convention as src/lib/data/engineering.ts.
  return DISCIPLINE_LABEL[classifyDiscipline(jobTitle, undefined)];
}

const TENURE_BUCKETS = [
  { label: "< 1y", min: 0, max: 12 },
  { label: "1-2y", min: 12, max: 24 },
  { label: "2-3y", min: 24, max: 36 },
  { label: "3y+", min: 36, max: Infinity },
] as const;

export function getTenureBucket(months: number): string {
  for (const b of TENURE_BUCKETS) {
    if (months >= b.min && months < b.max) return b.label;
  }
  return "3y+";
}

export function matchesRole(
  jobTitle: string | null,
  selectedRoles: Set<string>
): boolean {
  if (selectedRoles.size === 0) return true;
  return selectedRoles.has(categorizeRole(jobTitle));
}

interface FilterableRow {
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  tenureMonths: number | null;
}

export function EngineeringFilters<T extends FilterableRow>({
  data,
  filters,
  onFiltersChange,
}: {
  data: T[];
  filters: EngineeringFilterState;
  onFiltersChange: (f: EngineeringFilterState) => void;
}) {
  // Derive available options from data
  const roleCounts = new Map<string, number>();
  const levels = new Set<string>();
  const squads = new Set<string>();

  for (const row of data) {
    const role = categorizeRole(row.jobTitle);
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    if (row.level) levels.add(row.level);
    if (row.squad) squads.add(row.squad);
  }

  const sortedLevels = [...levels].sort();
  const sortedSquads = [...squads].sort();
  const roleEntries = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]);

  const hasActiveFilter =
    filters.roles.size > 0 ||
    filters.level !== "all" ||
    filters.squad !== "all" ||
    filters.tenureBuckets.size > 0;

  const toggleRole = (role: string) => {
    const next = new Set(filters.roles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    onFiltersChange({ ...filters, roles: next });
  };

  const toggleTenureBucket = (bucket: string) => {
    const next = new Set(filters.tenureBuckets);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    onFiltersChange({ ...filters, tenureBuckets: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Role pills */}
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
        {roleEntries.map(([role, count]) => (
          <button
            key={role}
            onClick={() => toggleRole(role)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              filters.roles.has(role)
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {role}
            <span className="ml-1 text-[10px] opacity-60">{count}</span>
          </button>
        ))}
      </div>

      {/* Level select */}
      {sortedLevels.length > 0 && (
        <select
          value={filters.level}
          onChange={(e) =>
            onFiltersChange({ ...filters, level: e.target.value })
          }
          className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus:border-primary"
        >
          <option value="all">All levels</option>
          {sortedLevels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}

      {/* Squad select */}
      {sortedSquads.length > 0 && (
        <select
          value={filters.squad}
          onChange={(e) =>
            onFiltersChange({ ...filters, squad: e.target.value })
          }
          className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus:border-primary"
        >
          <option value="all">All squads</option>
          {sortedSquads.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {/* Tenure pills */}
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
        <span className="px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Tenure
        </span>
        {TENURE_BUCKETS.map((b) => (
          <button
            key={b.label}
            onClick={() => toggleTenureBucket(b.label)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              filters.tenureBuckets.has(b.label)
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Clear all */}
      {hasActiveFilter && (
        <button
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
