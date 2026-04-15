"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Users, LayoutGrid, Layers } from "lucide-react";
import { EngineeringTable } from "./engineering-table";
import { EngineeringSquadView } from "./engineering-squad-view";

type ViewMode = "engineers" | "squads" | "pillars";

interface EngineerData {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
}

export function EngineeringViewToggle({ data }: { data: EngineerData[] }) {
  const [view, setView] = useState<ViewMode>("engineers");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5 w-fit">
        <button
          onClick={() => setView("engineers")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "engineers"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Engineers
        </button>
        <button
          onClick={() => setView("squads")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "squads"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Squads
        </button>
        <button
          onClick={() => setView("pillars")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "pillars"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Pillars
        </button>
      </div>

      {view === "engineers" ? (
        <EngineeringTable data={data} />
      ) : (
        <EngineeringSquadView data={data} groupBy={view === "pillars" ? "pillar" : "squad"} />
      )}
    </div>
  );
}
