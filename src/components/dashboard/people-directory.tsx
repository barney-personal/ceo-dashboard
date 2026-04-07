"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, MapPin } from "lucide-react";

interface PersonData {
  name: string;
  jobTitle: string;
  level: string;
  squad: string;
  function: string;
  location: string;
  tenureMonths: number;
}

interface FunctionGroup {
  name: string;
  squads: { name: string; people: PersonData[] }[];
}

interface PeopleDirectoryProps {
  functions: FunctionGroup[];
}

function formatTenure(months: number): string {
  if (months < 1) return "< 1 month";
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (remaining === 0) return `${years}y`;
  return `${years}y ${remaining}mo`;
}

export function PeopleDirectory({ functions }: PeopleDirectoryProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleFunction = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return functions;

    const q = search.toLowerCase();
    return functions
      .map((fn) => ({
        ...fn,
        squads: fn.squads
          .map((sq) => ({
            ...sq,
            people: sq.people.filter(
              (p) =>
                p.name.toLowerCase().includes(q) ||
                p.jobTitle.toLowerCase().includes(q) ||
                p.squad.toLowerCase().includes(q) ||
                p.level.toLowerCase().includes(q)
            ),
          }))
          .filter((sq) => sq.people.length > 0),
      }))
      .filter((fn) => fn.squads.length > 0);
  }, [functions, search]);

  const totalShown = filtered.reduce(
    (sum, fn) => sum + fn.squads.reduce((s, sq) => s + sq.people.length, 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Team Directory
        </h3>
        <span className="text-xs text-muted-foreground">
          {totalShown} {totalShown === 1 ? "person" : "people"}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, role, squad, or level..."
          className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm outline-none shadow-warm placeholder:text-muted-foreground/40 focus:border-primary/30"
        />
      </div>

      {/* Function groups */}
      {filtered.map((fn) => {
        const isCollapsed = collapsed.has(fn.name);
        const count = fn.squads.reduce((s, sq) => s + sq.people.length, 0);

        return (
          <div
            key={fn.name}
            className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm"
          >
            <button
              onClick={() => toggleFunction(fn.name)}
              className="flex w-full items-center justify-between border-b border-border/50 bg-muted/30 px-5 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-semibold text-foreground">
                  {fn.name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {count} {count === 1 ? "person" : "people"}
              </span>
            </button>

            {!isCollapsed && (
              <div className="divide-y divide-border/30">
                {fn.squads.map((squad) => (
                  <div key={squad.name}>
                    <div className="bg-muted/10 px-5 py-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {squad.name}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground/50">
                        {squad.people.length}
                      </span>
                    </div>
                    <div className="px-5 py-2 space-y-1">
                      {squad.people.map((person) => (
                        <div
                          key={`${person.name}-${person.jobTitle}`}
                          className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-foreground">
                              {person.name}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {person.jobTitle}
                            </span>
                          </div>
                          {person.level && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              {person.level}
                            </span>
                          )}
                          {person.location && (
                            <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/60 sm:flex">
                              <MapPin className="h-2.5 w-2.5" />
                              {person.location}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                            {formatTenure(person.tenureMonths)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && search.trim() && (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No results for &ldquo;{search}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
