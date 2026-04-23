"use client";

import { useState } from "react";
import type { ImpactEngineerPrediction } from "@/lib/data/impact-model";

interface Props {
  engineers: ImpactEngineerPrediction[];
}

type Mode = "under" | "over";

export function OutlierTable({ engineers }: Props) {
  const [mode, setMode] = useState<Mode>("under");

  const sorted = [...engineers].sort((a, b) =>
    mode === "under" ? b.residual - a.residual : a.residual - b.residual,
  );
  const top = sorted.slice(0, 10);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {mode === "under"
            ? "Engineers the model under-predicts (actual ≫ predicted)"
            : "Engineers the model over-predicts (actual ≪ predicted)"}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5">
          <button
            onClick={() => setMode("under")}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              mode === "under"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Under-predicted
          </button>
          <button
            onClick={() => setMode("over")}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              mode === "over"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Over-predicted
          </button>
        </div>
      </div>
      <p className="mb-4 text-xs italic text-muted-foreground">
        {mode === "under"
          ? "Signal: demographic + engagement features didn't explain their high output. They're outperforming what the model expected for their tenure, level, and engagement profile."
          : "Signal: features suggested more output than actually shipped. Worth a look — may be hidden blockers, vacation, or role shift."}
      </p>
      <div className="overflow-hidden rounded-lg border border-border/40">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Engineer</th>
              <th className="px-3 py-2 text-left">Discipline</th>
              <th className="px-3 py-2 text-left">Level</th>
              <th className="px-3 py-2 text-right">Tenure</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Predicted</th>
              <th className="px-3 py-2 text-right">Residual</th>
            </tr>
          </thead>
          <tbody>
            {top.map((e, i) => (
              <tr
                key={e.email_hash}
                className={i % 2 === 0 ? "bg-transparent" : "bg-muted/10"}
              >
                <td className="px-3 py-2 font-medium text-foreground">{e.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.discipline}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.level_label}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {e.tenure_months.toFixed(0)}mo
                </td>
                <td className="px-3 py-2 text-right font-mono">{e.actual.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {e.predicted.toLocaleString()}
                </td>
                <td
                  className="px-3 py-2 text-right font-mono font-medium"
                  style={{ color: e.residual > 0 ? "#2e7d52" : "#b8472a" }}
                >
                  {e.residual > 0 ? "+" : ""}
                  {e.residual.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
