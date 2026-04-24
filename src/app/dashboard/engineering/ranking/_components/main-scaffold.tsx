import type { EngineeringRankingSnapshot } from "@/lib/data/engineering-ranking";
import { CompositeTopTable } from "./composite-table";
import {
  DominanceWarnings,
  EmptyCohortState,
  ReconciliationFailuresBanner,
  TieGroupsPanel,
} from "./sections";
import { RankingHeader } from "./shared";

export function MainScaffold({
  snapshot,
  profileSlugByHash,
  canSeeHrReview,
}: {
  snapshot: EngineeringRankingSnapshot;
  profileSlugByHash: Record<string, string>;
  canSeeHrReview: boolean;
}) {
  const links = [
    {
      href: "/dashboard/engineering/ranking/methodology",
      label: "Methodology & diagnostics",
    },
  ];
  if (canSeeHrReview) {
    links.push({
      href: "/dashboard/engineering/ranking/hr-review",
      label: "HR review",
    });
  }

  return (
    <div className="space-y-6">
      <RankingHeader
        snapshot={snapshot}
        title="Engineer ranking"
        subtitle="A cohort-relative composite of every engineer at Cleo. Click a row for per-method breakdown, lifts / drags, and PR evidence."
        links={links}
      />

      <p className="rounded-md border border-border/60 bg-background/60 px-4 py-2 text-xs italic text-muted-foreground">
        Decision support, not a final judgment — see{" "}
        <a
          href="/dashboard/engineering/ranking/methodology"
          className="text-primary hover:underline"
        >
          methodology
        </a>{" "}
        for how the composite is built.
      </p>

      <DominanceWarnings composite={snapshot.composite} />

      <ReconciliationFailuresBanner attribution={snapshot.attribution} />

      <CompositeTopTable
        composite={snapshot.composite}
        confidence={snapshot.confidence}
        attribution={snapshot.attribution}
        profileSlugByHash={profileSlugByHash}
      />

      <TieGroupsPanel confidence={snapshot.confidence} />

      <EmptyCohortState snapshot={snapshot} />
    </div>
  );
}
