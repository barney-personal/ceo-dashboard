"use client";

import { useMemo, useState } from "react";
import { CohortHeatmap, type CohortRow } from "./cohort-heatmap";
import { cn } from "@/lib/utils";

interface ConversionHeatmapToggleProps {
  data: { [product: string]: CohortRow[] };
  modeUrl?: string;
}

const PRODUCT_ORDER = ["All", "Plus", "AI Pro", "Builder"];

export function ConversionHeatmapToggle({
  data,
  modeUrl,
}: ConversionHeatmapToggleProps) {
  const products = PRODUCT_ORDER.filter((p) => p in data);
  const [active, setActive] = useState(products[0] ?? "All");

  const rows = data[active] ?? [];

  // Compute color domain from the active product's data so the full
  // red→green spectrum stretches across the actual value range.
  const colorDomain = useMemo<[number, number]>(() => {
    const vals = rows.flatMap((r) => r.periods.filter((v): v is number => v != null));
    if (vals.length === 0) return [0, 1];
    return [Math.min(...vals), Math.max(...vals)];
  }, [rows]);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-foreground">
            Conversion to Paid
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            By cohort month and measurement window
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-0.5">
          {products.map((p) => (
            <button
              key={p}
              onClick={() => setActive(p)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                active === p
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <CohortHeatmap
          data={rows}
          periodLabel="Month"
          title=""
          modeUrl={modeUrl}
          bare
          colorDomain={colorDomain}
        />
      )}
    </div>
  );
}
