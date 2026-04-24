import { Info } from "lucide-react";
import type { Role } from "@/lib/auth/roles";

export type EngineeringBPersona = "engineer" | "manager";

export function resolvePersona(effectiveRole: Role): EngineeringBPersona {
  return effectiveRole === "ceo" || effectiveRole === "leadership"
    ? "manager"
    : "engineer";
}

interface EngineeringBRootProps {
  effectiveRole: Role;
}

export function EngineeringBRoot({ effectiveRole }: EngineeringBRootProps) {
  const persona = resolvePersona(effectiveRole);
  return (
    <section
      data-testid="engineering-b-root"
      data-persona={persona}
      className="space-y-6"
    >
      <div className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-display text-lg italic text-foreground">
              Engineering — simplified view
            </p>
            <p className="text-sm text-muted-foreground">
              {persona === "manager"
                ? "Manager view: stack rank with promote / performance-manage candidates, confidence bands, and per-engineer attribution. Composite score and rendering land in milestones M6 – M9."
                : "Engineer view: your own percentile bands across org, pillar, and squad, with 2 – 4 concrete takeaways. Composite score and rendering land in milestones M6 – M9."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-center">
        <p className="font-display text-base italic text-muted-foreground">
          B-side surface
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Single root. No tabs. No impact model. No competing ranks.
        </p>
      </div>
    </section>
  );
}
