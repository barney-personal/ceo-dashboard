import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";

export default function OKRsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="OKRs"
        description="Company objectives and key results from Slack and Notion"
      />

      <SectionCard title="Q2 2026 Objectives">
        <div className="space-y-4">
          {[
            {
              objective: "Ship CEO Dashboard v1",
              keyResults: [
                {
                  name: "All data sources connected",
                  progress: 0,
                  status: "on_track" as const,
                },
                {
                  name: "Role-based access working",
                  progress: 100,
                  status: "completed" as const,
                },
                {
                  name: "Deployed to production",
                  progress: 0,
                  status: "on_track" as const,
                },
              ],
            },
          ].map((obj) => (
            <div key={obj.objective}>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="font-display text-base italic text-foreground">
                  {obj.objective}
                </h4>
              </div>
              <div className="space-y-2">
                {obj.keyResults.map((kr) => (
                  <div
                    key={kr.name}
                    className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-2.5"
                  >
                    <span className="text-sm text-foreground">{kr.name}</span>
                    <div className="flex items-center gap-3">
                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${kr.progress}%` }}
                          />
                        </div>
                        <span className="min-w-[2rem] text-right font-mono text-xs text-muted-foreground">
                          {kr.progress}%
                        </span>
                      </div>
                      <StatusBadge status={kr.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Connect Slack and Notion to automatically sync OKR updates.
        </p>
      </div>
    </div>
  );
}
