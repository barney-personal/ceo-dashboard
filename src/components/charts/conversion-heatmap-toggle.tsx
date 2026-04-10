"use client";

import { useState } from "react";
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

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <div>
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
        />
      )}
    </div>
  );
}
