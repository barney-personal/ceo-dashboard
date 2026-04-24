import { Info } from "lucide-react";

export function EngineerPlaceholder() {
  return (
    <section
      data-testid="engineering-b-engineer-placeholder"
      className="space-y-6"
    >
      <div className="rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-display text-lg italic text-foreground">
              Engineer view — coming in M11
            </p>
            <p className="text-sm text-muted-foreground">
              Your own percentile bands across org, pillar, and squad, with 2–4
              concrete takeaways and squad / pillar aggregate competition. No
              other engineer&apos;s individual rank will be visible here.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
