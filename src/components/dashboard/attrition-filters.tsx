"use client";

import { cn } from "@/lib/utils";

export interface AttritionFilterState {
  department: string | null;
  tenure: string | null;
}

interface AttritionFiltersProps {
  departments: string[];
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
      {/* Department filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Dept</span>
        <div className="flex gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          <button
            onClick={() => onFiltersChange({ ...filters, department: null })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              filters.department === null
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {departments.map((dept) => (
            <button
              key={dept}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  department: filters.department === dept ? null : dept,
                })
              }
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                filters.department === dept
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      {/* Tenure filter */}
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
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
