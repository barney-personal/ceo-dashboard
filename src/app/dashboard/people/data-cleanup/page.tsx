import { PageHeader } from "@/components/dashboard/page-header";
import { detectDataIssues } from "@/lib/data/data-cleanup";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

const SEVERITY_CONFIG = {
  high: {
    label: "High",
    bg: "bg-destructive/10",
    text: "text-destructive",
    border: "border-destructive/30",
    icon: AlertTriangle,
  },
  medium: {
    label: "Medium",
    bg: "bg-warning/10",
    text: "text-warning",
    border: "border-warning/30",
    icon: AlertTriangle,
  },
  low: {
    label: "Low",
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border/50",
    icon: Info,
  },
} as const;

export default async function DataCleanupPage() {
  const categories = await detectDataIssues();
  const totalIssues = categories.reduce((sum, c) => sum + c.issues.length, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Data Cleanup"
        description="Live data quality issues from HiBob and Rev. Fix at source and they'll clear automatically on next sync."
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {(["high", "medium", "low"] as const).map((severity) => {
          const config = SEVERITY_CONFIG[severity];
          const count = categories
            .filter((c) => c.severity === severity)
            .reduce((sum, c) => sum + c.issues.length, 0);
          return (
            <div
              key={severity}
              className={`rounded-xl border ${config.border} bg-card px-5 py-4 shadow-warm`}
            >
              <div className="flex items-center gap-2">
                <config.icon className={`h-4 w-4 ${config.text}`} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${config.text}`}>
                  {config.label}
                </span>
              </div>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                {count}
              </p>
              <p className="text-xs text-muted-foreground">
                {count === 1 ? "issue" : "issues"}
              </p>
            </div>
          );
        })}
      </div>

      {totalIssues === 0 && (
        <div className="flex h-40 items-center justify-center gap-3 rounded-xl border border-positive/30 bg-positive/5 shadow-warm">
          <CheckCircle2 className="h-5 w-5 text-positive" />
          <p className="text-sm font-medium text-positive">
            All clean — no data quality issues detected.
          </p>
        </div>
      )}

      {/* Issue categories */}
      {categories.map((category) => {
        const config = SEVERITY_CONFIG[category.severity];
        return (
          <details
            key={category.id}
            className="group rounded-xl border border-border/60 bg-card shadow-warm"
            open={category.severity === "high"}
          >
            <summary className="flex cursor-pointer select-none items-center gap-3 px-5 py-4 hover:bg-muted/30">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    {category.title}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}
                  >
                    <config.icon className="h-3 w-3" />
                    {config.label}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {category.issues.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {category.description}
                </p>
              </div>
              <svg
                className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </summary>

            <div className="border-t border-border/30">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 border-b border-border/20 bg-muted/20 px-5 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Person
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Field
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Current Value
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Suggested Fix
                </span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-border/20">
                {category.issues.map((issue, i) => (
                  <div
                    key={`${issue.email}-${issue.field}-${i}`}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 px-5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {issue.person}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground/60">
                        {issue.email}
                      </p>
                    </div>
                    <p className="self-center text-xs font-mono text-muted-foreground">
                      {issue.field}
                    </p>
                    <p className="self-center text-xs text-destructive/80">
                      {issue.currentValue}
                    </p>
                    <p className="self-center text-xs text-positive font-medium">
                      {issue.suggestedValue}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
