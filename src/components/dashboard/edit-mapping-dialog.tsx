"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Search, UserX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmployeeOption } from "@/lib/data/engineer-profile";

interface EditMappingDialogProps {
  login: string;
  currentEmployeeEmail: string | null;
  currentEmployeeName: string | null;
  employees: EmployeeOption[];
}

export function EditMappingDialog({
  login,
  currentEmployeeEmail,
  currentEmployeeName,
  employees,
}: EditMappingDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(
    currentEmployeeEmail
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setSelectedEmail(currentEmployeeEmail);
      setSearch("");
      setError(null);
      // Autofocus the search box when the dialog opens
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, currentEmployeeEmail]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.jobTitle?.toLowerCase().includes(q) ?? false) ||
        (e.squad?.toLowerCase().includes(q) ?? false)
    );
  }, [employees, search]);

  const save = async (payload: {
    employeeEmail: string | null;
    employeeName: string | null;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/github-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Save failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectedEmployee = employees.find((e) => e.email === selectedEmail);
  const canSave =
    selectedEmail !== currentEmployeeEmail ||
    (selectedEmployee?.name ?? null) !== currentEmployeeName;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-warm transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
      >
        <Pencil className="h-3 w-3" />
        Edit mapping
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 pt-[10vh] backdrop-blur-sm"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg italic text-foreground">
                  Edit mapping
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Reassign GitHub{" "}
                  <span className="font-medium text-foreground">@{login}</span>{" "}
                  to another employee.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Current mapping */}
            <div className="border-b border-border/50 bg-muted/20 px-5 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Currently mapped to
              </div>
              <div className="mt-1 text-sm text-foreground">
                {currentEmployeeName ? (
                  <>
                    {currentEmployeeName}
                    {currentEmployeeEmail && (
                      <span className="ml-2 text-muted-foreground">
                        {currentEmployeeEmail}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="italic text-muted-foreground">
                    Not mapped
                  </span>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="border-b border-border/50 px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, squad, or role…"
                  className="w-full rounded-lg border border-border/60 bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/40"
                />
              </div>
            </div>

            {/* Employee list */}
            <div className="max-h-[40vh] overflow-y-auto">
              {employees.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No employee directory available. HiBob data may not be synced
                  yet.
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No employees match &ldquo;{search}&rdquo;.
                </div>
              ) : (
                <ul className="divide-y divide-border/30">
                  {filtered.map((emp) => {
                    const isSelected = emp.email === selectedEmail;
                    return (
                      <li key={emp.email}>
                        <button
                          type="button"
                          onClick={() => setSelectedEmail(emp.email)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/30",
                            isSelected && "bg-primary/5 hover:bg-primary/10"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {emp.name}
                              </span>
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span className="truncate">{emp.email}</span>
                              {emp.jobTitle && <span>·</span>}
                              {emp.jobTitle && <span>{emp.jobTitle}</span>}
                              {emp.squad && <span>·</span>}
                              {emp.squad && <span>{emp.squad}</span>}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="border-t border-destructive/30 bg-destructive/5 px-5 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-5 py-3">
              {currentEmployeeEmail ? (
                <button
                  type="button"
                  onClick={() =>
                    save({ employeeEmail: null, employeeName: null })
                  }
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <UserX className="h-3.5 w-3.5" />
                  Clear mapping
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const emp = employees.find(
                      (e) => e.email === selectedEmail
                    );
                    save({
                      employeeEmail: emp?.email ?? null,
                      employeeName: emp?.name ?? null,
                    });
                  }}
                  disabled={saving || !canSave || !selectedEmail}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save mapping"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
