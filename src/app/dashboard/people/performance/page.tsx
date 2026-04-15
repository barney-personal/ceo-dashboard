import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { PerformanceDrilldown } from "@/components/dashboard/performance-drilldown";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import {
  getPerformanceData,
  groupPerformanceByPillar,
  groupPerformanceByFunction,
} from "@/lib/data/performance";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function PeoplePerformancePage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const { people, reviewCycles } = await getPerformanceData();
  const pillarGroups = groupPerformanceByPillar(people);
  const functionGroups = groupPerformanceByFunction(people);
  const modeUrl = getModeReportLink("people", "performance");

  // Serialize for client component (strip any non-POJO artifacts)
  const serializedPillars = pillarGroups.map((p) => ({
    name: p.name,
    count: p.count,
    squads: p.squads.map((s) => ({
      name: s.name,
      people: s.people.map((person) => ({
        email: person.email,
        name: person.name,
        jobTitle: person.jobTitle,
        level: person.level,
        squad: person.squad,
        pillar: person.pillar,
        function: person.function,
        ratings: person.ratings.map((r) => ({
          reviewCycle: r.reviewCycle,
          rating: r.rating,
          reviewerName: r.reviewerName,
          flagged: r.flagged,
          missed: r.missed,
        })),
      })),
    })),
  }));

  const serializedFunctions = functionGroups.map((g) => ({
    name: g.name,
    people: g.people.map((person) => ({
      email: person.email,
      name: person.name,
      jobTitle: person.jobTitle,
      level: person.level,
      squad: person.squad,
      pillar: person.pillar,
      function: person.function,
      ratings: person.ratings.map((r) => ({
        reviewCycle: r.reviewCycle,
        rating: r.rating,
        reviewerName: r.reviewerName,
        flagged: r.flagged,
        missed: r.missed,
      })),
    })),
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Performance"
        description="Individual performance ratings across review cycles"
      />

      {people.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No performance data available yet. Data will appear after the next Mode sync.
          </p>
        </div>
      ) : (
        <PerformanceDrilldown
          pillarGroups={serializedPillars}
          functionGroups={serializedFunctions}
          reviewCycles={reviewCycles}
        />
      )}

      {modeUrl && (
        <div className="flex justify-end">
          <a
            href={modeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground/60 underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
          >
            View in Mode
          </a>
        </div>
      )}
    </div>
  );
}
