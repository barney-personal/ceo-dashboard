"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronLeft, ChevronRight, LogIn, Search } from "lucide-react";

interface User {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  imageUrl: string | null;
  role: string;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  sessionCount: number;
}

interface UserAdminProps {
  initialUsers: User[];
}

const ROLES = [
  "everyone",
  "engineering_manager",
  "leadership",
  "ceo",
] as const;

const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  everyone: "everyone",
  engineering_manager: "eng manager",
  leadership: "leadership",
  ceo: "ceo",
};

const ROLE_BADGE_STYLES: Record<string, string> = {
  ceo: "bg-primary/10 text-primary border-primary/20",
  leadership: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  engineering_manager: "bg-sky-500/10 text-sky-700 border-sky-500/20",
  everyone: "bg-muted text-muted-foreground border-border/60",
};

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = firstName?.[0] ?? "";
  const l = lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function startImpersonation(user: User) {
  const payload = JSON.stringify({
    userId: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown",
    role: user.role,
  });
  document.cookie = `impersonate=${encodeURIComponent(payload)}; path=/; max-age=86400`;
}

const PAGE_SIZE = 25;

export function UserAdmin({ initialUsers }: UserAdminProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const router = useRouter();

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, query]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const visibleUsers = filteredUsers.slice(pageStart, pageStart + PAGE_SIZE);

  const updateRole = async (userId: string, newRole: string) => {
    setUpdatingId(userId);
    setSuccessId(null);
    setErrorId(null);

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
        setSuccessId(userId);
        setTimeout(() => setSuccessId(null), 2000);
      } else {
        setErrorId(userId);
        setTimeout(() => setErrorId(null), 3000);
      }
    } catch {
      setErrorId(userId);
      setTimeout(() => setErrorId(null), 3000);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search name or email…"
          className="w-full rounded-lg border border-border/60 bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40"
        />
      </div>
      <div className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_1fr_140px_80px_120px_120px_auto] items-center gap-4 border-b border-border/50 bg-muted/30 px-5 py-3">
          <span className="w-8" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Name
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Email
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Role
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sessions
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Last active
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Last sign-in
          </span>
          <span className="w-20" />
        </div>

        {/* User rows */}
        <div className="divide-y divide-border/30">
          {visibleUsers.map((user) => {
            const isUpdating = updatingId === user.id;
            const isSuccess = successId === user.id;
            const isError = errorId === user.id;

            return (
              <div
                key={user.id}
                className={cn(
                  "grid grid-cols-[auto_1fr_1fr_140px_80px_120px_120px_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/20",
                  isSuccess && "bg-positive/[0.03]",
                  isError && "bg-destructive/[0.03]"
                )}
              >
                {/* Avatar */}
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {user.imageUrl ? (
                    <img
                      src={user.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitials(user.firstName, user.lastName)
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {[user.firstName, user.lastName].filter(Boolean).join(" ") ||
                      "Unknown"}
                  </span>
                </div>

                {/* Email */}
                <span className="truncate text-sm text-muted-foreground">
                  {user.email ?? "—"}
                </span>

                {/* Role dropdown */}
                <div className="relative">
                  <select
                    value={user.role}
                    onChange={(e) => updateRole(user.id, e.target.value)}
                    disabled={isUpdating}
                    className={cn(
                      "w-full appearance-none rounded-lg border px-2.5 py-1.5 pr-7 text-xs font-medium outline-none transition-colors focus:border-primary/40",
                      ROLE_BADGE_STYLES[user.role] ?? ROLE_BADGE_STYLES.everyone,
                      isUpdating && "opacity-50"
                    )}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  {isUpdating && (
                    <div className="absolute -right-5 top-1/2 -translate-y-1/2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                </div>

                {/* Sessions */}
                <span className="text-xs font-mono tabular-nums text-muted-foreground">
                  {user.sessionCount}
                </span>

                {/* Last active */}
                <span className="text-xs text-muted-foreground">
                  {formatDate(user.lastActiveAt)}
                </span>

                {/* Last sign-in */}
                <span className="text-xs text-muted-foreground">
                  {formatDate(user.lastSignInAt)}
                </span>

                {/* Impersonate */}
                <button
                  onClick={() => {
                    startImpersonation(user);
                    router.push("/dashboard");
                    router.refresh();
                  }}
                  title={`View as ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "this user"}`}
                  className="flex w-20 items-center justify-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                >
                  <LogIn className="h-3 w-3" />
                  View as
                </button>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {filteredUsers.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            {query ? "No users match your search" : "No users found"}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {query ? (
            <>
              {filteredUsers.length} of {users.length} user
              {users.length !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              {users.length} user{users.length !== 1 ? "s" : ""} total
            </>
          )}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 font-medium transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 font-medium transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
