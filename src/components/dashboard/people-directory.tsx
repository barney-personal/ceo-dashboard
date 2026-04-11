"use client";

import { useState, useMemo } from "react";
import { Search, ArrowLeft, MapPin, Users, Briefcase, Calendar, Clock, Mail, UserIcon } from "lucide-react";

interface PersonData {
  name: string;
  email: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  manager: string;
  startDate: string;
  location: string;
  tenureMonths: number;
  employmentType: string;
}

interface SquadGroup {
  name: string;
  people: PersonData[];
}

interface PillarGroup {
  name: string;
  count: number;
  isProduct: boolean;
  squads: SquadGroup[];
}

interface PeopleDirectoryProps {
  pillars: PillarGroup[];
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

function PillarCard({
  pillar,
  onSelect,
}: {
  pillar: PillarGroup;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(pillar.name)}
      className="group rounded-xl border border-border/60 bg-card p-5 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
    >
      <h4 className="text-base font-semibold text-foreground">
        {pillar.name}
      </h4>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        {pillar.count} {pillar.count === 1 ? "person" : "people"}
        <span className="text-muted-foreground/50">
          · {pillar.squads.length} {pillar.squads.length === 1 ? "squad" : "squads"}
        </span>
      </div>
      <div className="mt-3 space-y-1">
        {pillar.squads.slice(0, 5).map((sq) => (
          <div
            key={sq.name}
            className="flex items-center justify-between text-xs"
          >
            <span className="truncate text-muted-foreground">{sq.name}</span>
            <span className="ml-2 shrink-0 font-mono text-muted-foreground/50">
              {sq.people.length}
            </span>
          </div>
        ))}
        {pillar.squads.length > 5 && (
          <span className="text-[10px] text-muted-foreground/40">
            + {pillar.squads.length - 5} more
          </span>
        )}
      </div>
    </button>
  );
}

export function PeopleDirectory({ pillars }: PeopleDirectoryProps) {
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonData | null>(null);
  const [search, setSearch] = useState("");

  const activePillar = pillars.find((p) => p.name === selectedPillar);
  const activeSquad = activePillar?.squads.find((s) => s.name === selectedSquad);

  const filteredSquadPeople = useMemo(() => {
    if (!activeSquad) return [];
    if (!search.trim()) return activeSquad.people;
    const q = search.toLowerCase();
    return activeSquad.people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.jobTitle.toLowerCase().includes(q) ||
        p.level.toLowerCase().includes(q)
    );
  }, [activeSquad, search]);

  const filteredPillarSquads = useMemo(() => {
    if (!activePillar || selectedSquad) return [];
    if (!search.trim()) return activePillar.squads;
    const q = search.toLowerCase();
    return activePillar.squads
      .map((sq) => ({
        ...sq,
        people: sq.people.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.jobTitle.toLowerCase().includes(q) ||
            sq.name.toLowerCase().includes(q)
        ),
      }))
      .filter((sq) => sq.people.length > 0);
  }, [activePillar, selectedSquad, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Team Directory
        </h3>
      </div>

      {/* ── Pillar overview ── */}
      {!selectedPillar && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pillars.filter((p) => p.isProduct).map((pillar) => (
              <PillarCard key={pillar.name} pillar={pillar} onSelect={setSelectedPillar} />
            ))}
          </div>

          {pillars.some((p) => !p.isProduct) && (
            <div className="space-y-4 pt-4">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/50" />
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                  Business Operations
                </span>
                <div className="h-px flex-1 bg-border/50" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pillars.filter((p) => !p.isProduct).map((pillar) => (
                  <PillarCard key={pillar.name} pillar={pillar} onSelect={setSelectedPillar} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Pillar detail: squad list ── */}
      {selectedPillar && activePillar && !selectedSquad && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedPillar(null);
                setSearch("");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All pillars
            </button>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {activePillar.name}
              </h3>
              <span className="text-xs text-muted-foreground">
                {activePillar.count} people · {activePillar.squads.length} squads
              </span>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people in this pillar..."
              className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm outline-none shadow-warm placeholder:text-muted-foreground/40 focus:border-primary/30"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {filteredPillarSquads.map((squad) => (
              <button
                key={squad.name}
                onClick={() => {
                  setSelectedSquad(squad.name);
                  setSearch("");
                }}
                className="rounded-xl border border-border/60 bg-card p-4 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {squad.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {squad.people.length}
                  </span>
                </div>
                <div className="mt-2 space-y-0.5">
                  {squad.people.slice(0, 4).map((p) => (
                    <div
                      key={`${p.name}-${p.jobTitle}`}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span className="truncate">{p.name}</span>
                      {p.level && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                          {p.level}
                        </span>
                      )}
                    </div>
                  ))}
                  {squad.people.length > 4 && (
                    <span className="text-[10px] text-muted-foreground/40">
                      + {squad.people.length - 4} more
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {filteredPillarSquads.length === 0 && search.trim() && (
            <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No results for &ldquo;{search}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Squad detail: people list ── */}
      {selectedPillar && activePillar && selectedSquad && activeSquad && !selectedPerson && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedSquad(null);
                setSearch("");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {activePillar.name}
            </button>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {activeSquad.name}
              </h3>
              <span className="text-xs text-muted-foreground">
                {activeSquad.people.length} people
              </span>
            </div>
          </div>

          {activeSquad.people.length > 8 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people..."
                className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm outline-none shadow-warm placeholder:text-muted-foreground/40 focus:border-primary/30"
              />
            </div>
          )}

          <div className="rounded-xl border border-border/60 bg-card shadow-warm">
            <div className="divide-y divide-border/30">
              {filteredSquadPeople.map((person) => (
                <button
                  key={`${person.name}-${person.jobTitle}`}
                  onClick={() => setSelectedPerson(person)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30"
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
                  <span className="hidden shrink-0 text-xs text-muted-foreground/60 sm:block">
                    {person.function}
                  </span>
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

          {filteredSquadPeople.length === 0 && search.trim() && (
            <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No results for &ldquo;{search}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Person detail ── */}
      {selectedPerson && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedPerson(null)}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {activeSquad?.name ?? activePillar?.name ?? "Back"}
            </button>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm space-y-5">
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                {selectedPerson.name}
              </h3>
              {selectedPerson.jobTitle && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {selectedPerson.jobTitle}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      )}
    </div>
  );
}
