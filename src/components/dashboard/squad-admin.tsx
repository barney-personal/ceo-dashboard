"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Check, X, ChevronDown } from "lucide-react";

interface Squad {
  id: number;
  name: string;
  pillar: string;
  channelId: string | null;
  pmName: string | null;
  pmSlackId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SquadAdminProps {
  initialSquads: Squad[];
}

const PILLARS = [
  "Growth",
  "EWA & Credit Products",
  "Chat",
  "New Bets",
  "Access, Trust & Money, Risk & Payments",
  "Card",
];

export function SquadAdmin({ initialSquads }: SquadAdminProps) {
  const [allSquads, setAllSquads] = useState<Squad[]>(initialSquads);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    pillar: "",
    pmName: "",
    channelId: "",
    isActive: true,
  });

  // Add form state
  const [addForm, setAddForm] = useState({
    name: "",
    pillar: PILLARS[0],
    pmName: "",
    channelId: "",
  });

  const startEdit = (squad: Squad) => {
    setEditingId(squad.id);
    setEditForm({
      name: squad.name,
      pillar: squad.pillar,
      pmName: squad.pmName ?? "",
      channelId: squad.channelId ?? "",
      isActive: squad.isActive,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch("/api/squads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editForm }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAllSquads((prev) =>
          prev.map((s) =>
            s.id === id ? { ...updated, createdAt: updated.createdAt, updatedAt: updated.updatedAt } : s
          )
        );
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const addSquad = async () => {
    if (!addForm.name || !addForm.pillar) return;
    setSaving(true);
    try {
      const res = await fetch("/api/squads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        const created = await res.json();
        setAllSquads((prev) =>
          [...prev, { ...created, createdAt: created.createdAt, updatedAt: created.updatedAt }].sort(
            (a, b) => a.pillar.localeCompare(b.pillar) || a.name.localeCompare(b.name)
          )
        );
        setAddForm({ name: "", pillar: PILLARS[0], pmName: "", channelId: "" });
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  };

  // Group by pillar
  const byPillar = new Map<string, Squad[]>();
  for (const squad of allSquads) {
    const existing = byPillar.get(squad.pillar) ?? [];
    existing.push(squad);
    byPillar.set(squad.pillar, existing);
  }

  return (
    <div className="space-y-6">
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-warm transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          Add Squad
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-xl border border-primary/20 bg-card p-5 shadow-warm">
          <h3 className="mb-4 text-sm font-semibold text-foreground">New Squad</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              placeholder="Squad name"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
            />
            <div className="relative">
              <select
                value={addForm.pillar}
                onChange={(e) => setAddForm({ ...addForm, pillar: e.target.value })}
                className="w-full appearance-none rounded-lg border border-border/60 bg-background px-3 py-2 pr-8 text-sm outline-none focus:border-primary/40"
              >
                {PILLARS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
            <input
              type="text"
              placeholder="PM name"
              value={addForm.pmName}
              onChange={(e) => setAddForm({ ...addForm, pmName: e.target.value })}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
            />
            <div className="flex gap-2">
              <button
                onClick={addSquad}
                disabled={saving || !addForm.name}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Add"}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Squad table grouped by pillar */}
      {[...byPillar.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pillar, pillarSquads]) => (
          <div key={pillar} className="rounded-xl border border-border/60 bg-card shadow-warm overflow-hidden">
            <div className="border-b border-border/50 bg-muted/30 px-5 py-3">
              <h3 className="text-sm font-semibold text-foreground">{pillar}</h3>
              <span className="text-xs text-muted-foreground">{pillarSquads.length} squads</span>
            </div>
            <div className="divide-y divide-border/30">
              {pillarSquads.map((squad) =>
                editingId === squad.id ? (
                  /* Edit row */
                  <div key={squad.id} className="flex items-center gap-3 bg-primary/[0.02] px-5 py-3">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-primary/40"
                    />
                    <input
                      type="text"
                      value={editForm.pmName}
                      onChange={(e) => setEditForm({ ...editForm, pmName: e.target.value })}
                      placeholder="PM name"
                      className="w-40 rounded-md border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-primary/40"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={editForm.isActive}
                        onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                        className="rounded"
                      />
                      Active
                    </label>
                    <button
                      onClick={() => saveEdit(squad.id)}
                      disabled={saving}
                      className="rounded-md bg-positive/10 p-1.5 text-positive transition-colors hover:bg-positive/20"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md bg-muted p-1.5 text-muted-foreground transition-colors hover:bg-muted/80"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  /* Display row */
                  <div
                    key={squad.id}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/20",
                      !squad.isActive && "opacity-50"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground">
                        {squad.name}
                      </span>
                      {!squad.isActive && (
                        <span className="ml-2 text-[10px] font-medium uppercase text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </div>
                    <span className="w-40 truncate text-xs text-muted-foreground">
                      {squad.pmName ?? "—"}
                    </span>
                    <button
                      onClick={() => startEdit(squad)}
                      className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
