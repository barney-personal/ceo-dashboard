"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import type { DepartmentOption } from "@/lib/data/attrition-utils";

export interface AttritionFilterState {
  department: string | null;
  tenure: string | null;
}

interface AttritionFiltersProps {
  departments: DepartmentOption[];
  tenureBuckets: string[];
  filters: AttritionFilterState;
  onFiltersChange: (filters: AttritionFilterState) => void;
}

export function AttritionFilters({
  departments,
  tenureBuckets,
  filters,
  onFiltersChange,
}: AttritionFiltersProps) {
  const hasFilters = filters.department !== null || filters.tenure !== null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Department filter — native select (high cardinality) */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Dept</span>
        <select
          value={filters.department ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              department: e.target.value === "" ? null : e.target.value,
            })
          }
          className="h-7 max-w-[14rem] rounded-lg border border-border/60 bg-muted/30 px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus:border-primary/60"
        >
          <option value="">All departments</option>
          {departments.map((dept) => (
            <option key={dept.name} value={dept.name}>
              {dept.name} ({dept.headcount})
            </option>
          ))}
        </select>
      </div>

      {/* Tenure filter — pills (low cardinality) */}
      {tenureBuckets.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Tenure
          </span>
          <div className="flex gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
            <button
              onClick={() => onFiltersChange({ ...filters, tenure: null })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                filters.tenure === null
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
            {tenureBuckets.map((bucket) => (
              <button
                key={bucket}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    tenure: filters.tenure === bucket ? null : bucket,
                  })
                }
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  filters.tenure === bucket
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {bucket}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() => onFiltersChange({ department: null, tenure: null })}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
