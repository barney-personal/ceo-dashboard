import type { EngineeringRankingSnapshot } from "@/lib/data/engineering-ranking";
import {
  AttributionSection,
  CompositeDiagnosticsSection,
  ConfidenceSection,
  CoverageSection,
  KnownLimitationsSection,
  LensesSection,
  MethodologySection,
  MoversSection,
  NormalisationSection,
  PlannedSignalsSection,
  SignalAuditSection,
  StabilitySection,
} from "./sections";
import { RankingHeader } from "./shared";

export function MethodologyScaffold({
  snapshot,
}: {
  snapshot: EngineeringRankingSnapshot;
}) {
  return (
    <div className="space-y-6">
      <RankingHeader
        snapshot={snapshot}
        title="Methodology & diagnostics"
        subtitle="How the composite is built, what signals feed it, where it could be gamed, and how it holds up under stress. Everything the main ranking page stays silent about."
        links={[
          { href: "/dashboard/engineering/ranking", label: "Back to ranking" },
        ]}
      />

      <MethodologySection methodology={snapshot.methodology} />

      <CompositeDiagnosticsSection composite={snapshot.composite} />

      <ConfidenceSection confidence={snapshot.confidence} />

      <AttributionSection attribution={snapshot.attribution} />

      <MoversSection movers={snapshot.movers} />

      <StabilitySection stability={snapshot.stability} />

      <CoverageSection snapshot={snapshot} />

      <SignalAuditSection snapshot={snapshot} />

      <LensesSection lenses={snapshot.lenses} />

      <NormalisationSection
        normalisation={snapshot.normalisation}
        rampUpCount={snapshot.eligibility.coverage.rampUp}
      />

      <PlannedSignalsSection snapshot={snapshot} />

      <KnownLimitationsSection snapshot={snapshot} />
    </div>
  );
}
