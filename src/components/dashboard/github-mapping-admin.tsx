"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  scoreCandidatesForEmployee,
  type CandidateLogin,
  type EmployeeWithCandidates,
  type MappedEmployee,
  type ScoredCandidate,
} from "@/lib/data/github-mapping-shared";

interface GithubMappingAdminProps {
  unmappedEmployees: EmployeeWithCandidates[];
  mappedEmployees: MappedEmployee[];
  /** Untagged GitHub logins still committing in the last 90 days. Surfaced
   *  as a pickable list for each unmapped engineer. */
  recentCandidatePool: CandidateLogin[];
  totalActive: number;
  totalMapped: number;
}

type Tab = "unmapped" | "mapped";

const TENURE_COPY: Record<ScoredCandidate["tenureFlag"], string | null> = {
  compatible: "Tenure ✓",
  predates_start: "Predates start 60d+",
  long_predates_start: "Predates start 1y+",
  unknown: null,
};

function formatStartDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatActivityWindow(
  first: string | null,
  last: string | null,
  count: number
): string {
  if (!first || !last) return `${count.toLocaleString()} commits`;
  const f = new Date(first);
  const l = new Date(last);
  const fStr = f.toLocaleDateString("en-GB", { year: "numeric", month: "short" });
  const lStr = l.toLocaleDateString("en-GB", { year: "numeric", month: "short" });
  if (fStr === lStr) return `${count.toLocaleString()} commits · ${fStr}`;
  return `${count.toLocaleString()} commits · ${fStr} → ${lStr}`;
}

function formatTenureMonths(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years}y` : `${years}y ${rem}mo`;
}

export function GithubMappingAdmin({
  unmappedEmployees,
  mappedEmployees,
  recentCandidatePool,
  totalActive,
  totalMapped,
}: GithubMappingAdminProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    unmappedEmployees.length > 0 ? "unmapped" : "mapped"
  );
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(
    unmappedEmployees[0]?.email ?? null
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAvatars, setRefreshingAvatars] = useState(false);
  const [avatarSyncMessage, setAvatarSyncMessage] = useState<string | null>(
    null
  );

  const slackAvatarCount = useMemo(
    () => unmappedEmployees.filter((e) => e.slackAvatarUrl).length,
    [unmappedEmployees]
  );

  // Pre-rank the recent untagged pool against every unmapped engineer once,
  // so the per-row "Other untagged GitHub accounts" grid doesn't re-run a
  // full Jaro-Winkler pass on every unrelated state change (filter typing,
  // expand/collapse, etc.).
  const otherActiveByEmail = useMemo(() => {
    const map = new Map<string, ScoredCandidate[]>();
    for (const emp of unmappedEmployees) {
      const topLogins = new Set(emp.candidates.map((c) => c.login));
      map.set(
        emp.email,
        scoreCandidatesForEmployee(emp, recentCandidatePool).filter(
          (c) => !topLogins.has(c.login)
        )
      );
    }
    return map;
  }, [unmappedEmployees, recentCandidatePool]);

  const refreshSlackAvatars = async () => {
    setRefreshingAvatars(true);
    setError(null);
    setAvatarSyncMessage(null);
    try {
      const res = await fetch("/api/sync/slack-avatars", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `Refresh failed (${res.status})`);
        return;
      }
      setAvatarSyncMessage(
        `Refreshed Slack avatars — ${body.fetched} fetched, ${body.unchanged} unchanged, ${body.failed} failed (${body.total} total).`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingAvatars(false);
    }
  };

  const visibleEmployees = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return unmappedEmployees;
    return unmappedEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.squad.toLowerCase().includes(q) ||
        e.pillar.toLowerCase().includes(q)
    );
  }, [filter, unmappedEmployees]);

  const visibleMapped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return mappedEmployees;
    return mappedEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.squad.toLowerCase().includes(q) ||
        e.pillar.toLowerCase().includes(q) ||
        e.login.toLowerCase().includes(q)
    );
  }, [filter, mappedEmployees]);

  const removeMapping = async (mapped: MappedEmployee) => {
    const key = `remove|${mapped.login}`;
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/github-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: mapped.login,
          employeeEmail: null,
          employeeName: null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Remove failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setSavingKey(null);
    }
  };

  const save = async (
    employee: EmployeeWithCandidates,
    candidate: CandidateLogin
  ) => {
    const key = `${employee.email}|${candidate.login}`;
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/github-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: candidate.login,
          employeeEmail: employee.email,
          employeeName: employee.name,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Save failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary + tabs + filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-warm">
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab("unmapped")}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              tab === "unmapped"
                ? "bg-primary text-primary-foreground shadow-warm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Unmapped <span className="opacity-70">· {unmappedEmployees.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("mapped")}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              tab === "mapped"
                ? "bg-primary text-primary-foreground shadow-warm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Mapped <span className="opacity-70">· {mappedEmployees.length}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
          <span>
            {totalMapped} of {totalActive} mapped
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            {recentCandidatePool.length} untagged{" "}
            {recentCandidatePool.length === 1 ? "login" : "logins"} active in
            last 90d
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            {slackAvatarCount} of {unmappedEmployees.length} unmapped have
            Slack avatars
          </span>
        </div>
        <button
          type="button"
          onClick={refreshSlackAvatars}
          disabled={refreshingAvatars}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-warm transition-colors hover:bg-muted disabled:opacity-50"
          title="Fetch Slack profile pictures via users.info"
        >
          {refreshingAvatars ? "Refreshing…" : "Refresh Slack avatars"}
        </button>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, squad, pillar…"
            className="w-full rounded-lg border border-border/60 bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/40"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-destructive/70 hover:text-destructive"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {avatarSyncMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="flex-1">{avatarSyncMessage}</div>
          <button
            type="button"
            onClick={() => setAvatarSyncMessage(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {tab === "unmapped" && unmappedEmployees.length === 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-8 text-center shadow-warm">
          <Check className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Every active engineer is mapped.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalMapped} of {totalActive} active employees have a GitHub
            account assigned.
          </p>
        </div>
      )}

      {tab === "unmapped" && unmappedEmployees.length > 0 && (
      <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
        {visibleEmployees.map((emp) => {
          const isOpen = expanded === emp.email;
          const otherActive = otherActiveByEmail.get(emp.email) ?? [];

          return (
            <li key={emp.email} className="bg-card">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : emp.email)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30",
                  isOpen && "bg-muted/20"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="shrink-0">
                    {emp.slackAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={emp.slackAvatarUrl}
                        alt=""
                        title="Slack profile picture"
                        className="h-9 w-9 rounded-md border border-border/40 bg-muted object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border/40 bg-muted/40 text-[9px] font-medium uppercase text-muted-foreground/70"
                        title="No Slack avatar — refresh to fetch"
                      >
                        slack
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {emp.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {formatTenureMonths(emp.tenureMonths)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{emp.email}</span>
                      <span>·</span>
                      <span>{emp.pillar}</span>
                      <span>·</span>
                      <span>{emp.squad}</span>
                      {emp.jobTitle && <span>·</span>}
                      {emp.jobTitle && <span>{emp.jobTitle}</span>}
                      <span>·</span>
                      <span>started {formatStartDate(emp.startDate)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">
                    {emp.candidates.length === 0
                      ? "no plausible candidates"
                      : `${emp.candidates.length} candidate${
                          emp.candidates.length === 1 ? "" : "s"
                        }`}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-border/40 bg-muted/10 px-4 pb-4 pt-3">
                  {emp.candidates.length > 0 && (
                    <div>
                      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Top matches
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {emp.candidates.map((cand) => (
                          <CandidateCard
                            key={cand.login}
                            candidate={cand}
                            saving={savingKey === `${emp.email}|${cand.login}`}
                            onAssign={() => save(emp, cand)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Other untagged GitHub accounts active in last 90d
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        {otherActive.length}{" "}
                        {otherActive.length === 1 ? "account" : "accounts"} ·
                        ranked by name match
                      </div>
                    </div>
                    {otherActive.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center text-xs text-muted-foreground">
                        No other recently-active untagged accounts. If this
                        engineer&apos;s GitHub login isn&apos;t here, they may
                        not have committed in the last 90 days.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {otherActive.map((cand) => (
                          <CandidateCard
                            key={cand.login}
                            candidate={cand}
                            saving={savingKey === `${emp.email}|${cand.login}`}
                            onAssign={() => save(emp, cand)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      )}

      {tab === "unmapped" &&
        unmappedEmployees.length > 0 &&
        visibleEmployees.length === 0 && (
          <div className="rounded-xl border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-warm">
            No employees match &ldquo;{filter}&rdquo;.
          </div>
        )}

      {tab === "mapped" && (
        <MappedList
          rows={visibleMapped}
          totalCount={mappedEmployees.length}
          filter={filter}
          savingKey={savingKey}
          onRemove={removeMapping}
        />
      )}
    </div>
  );
}

function MappedList({
  rows,
  totalCount,
  filter,
  savingKey,
  onRemove,
}: {
  rows: MappedEmployee[];
  totalCount: number;
  filter: string;
  savingKey: string | null;
  onRemove: (m: MappedEmployee) => void;
}) {
  if (totalCount === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-warm">
        No engineers in this scope have a GitHub mapping yet.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-warm">
        No mappings match &ldquo;{filter}&rdquo;.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm">
      {rows.map((m) => {
        const isRemoving = savingKey === `remove|${m.login}`;
        const confidenceColor =
          m.matchConfidence === "high"
            ? "bg-primary/10 text-primary"
            : m.matchConfidence === "medium"
              ? "bg-muted text-muted-foreground"
              : "bg-amber-50 text-amber-900";
        return (
          <li
            key={m.email}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <div className="shrink-0">
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.avatarUrl}
                  alt=""
                  className="h-9 w-9 rounded-full border border-border/40 bg-muted"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/40 bg-muted text-[10px] font-medium uppercase text-muted-foreground">
                  {m.login.slice(0, 2)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {m.name}
                </span>
                <a
                  href={`https://github.com/${m.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-muted-foreground hover:text-primary"
                >
                  @{m.login}
                </a>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{m.email}</span>
                <span>·</span>
                <span>{m.squad}</span>
                {m.jobTitle && <span>·</span>}
                {m.jobTitle && <span>{m.jobTitle}</span>}
                {m.commitCount > 0 && <span>·</span>}
                {m.commitCount > 0 && (
                  <span>{m.commitCount.toLocaleString()} commits</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[10px]">
              {m.matchConfidence && (
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 font-medium",
                    confidenceColor
                  )}
                  title={`match_method=${m.matchMethod}`}
                >
                  {m.matchConfidence}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(m)}
                disabled={isRemoving}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
              >
                {isRemoving ? (
                  "Removing…"
                ) : (
                  <>
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </>
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CandidateCard({
  candidate,
  saving,
  onAssign,
}: {
  candidate: ScoredCandidate;
  saving: boolean;
  onAssign: () => void;
}) {
  const tenureCopy = TENURE_COPY[candidate.tenureFlag];
  const tenureWarn =
    candidate.tenureFlag === "predates_start" ||
    candidate.tenureFlag === "long_predates_start";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background p-3 transition-colors hover:border-primary/40">
      <div className="shrink-0">
        {candidate.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-border/40 bg-muted"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/40 bg-muted text-[10px] font-medium uppercase text-muted-foreground">
            {candidate.login.slice(0, 2)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <a
            href={`https://github.com/${candidate.login}`}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium text-foreground hover:text-primary"
          >
            @{candidate.login}
          </a>
          <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {candidate.score}
          </span>
        </div>
        {candidate.githubName && (
          <div className="truncate text-[11px] text-muted-foreground">
            {candidate.githubName}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          {formatActivityWindow(
            candidate.firstCommitAt,
            candidate.lastCommitAt,
            candidate.commitCount
          )}
          {candidate.prCount > 0 && ` · ${candidate.prCount} PRs`}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 font-medium",
              candidate.nameSim >= 80
                ? "bg-primary/10 text-primary"
                : candidate.nameSim >= 50
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted/50 text-muted-foreground/70"
            )}
          >
            name {candidate.nameSim}
          </span>
          {tenureCopy && (
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5",
                tenureWarn
                  ? "bg-amber-50 text-amber-900"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {tenureCopy}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onAssign}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                <Check className="h-3 w-3" />
                Assign
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

