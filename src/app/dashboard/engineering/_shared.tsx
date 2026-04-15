import { AlertTriangle } from "lucide-react";
import type { LoaderResult } from "@/lib/data/swarmia";

/**
 * Shared presentation helpers for the /dashboard/engineering sub-pages.
 * The underscore prefix tells Next.js this folder isn't a route.
 */

export function SectionEmpty({
  title,
  reason,
}: {
  title: string;
  reason: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="border-b border-border/50 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex h-48 items-center justify-center gap-3 p-5">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

export function loaderReason<T>(result: LoaderResult<T>, what: string): string {
  if (result.status === "not_configured") {
    return "Swarmia not configured — add SWARMIA_API_TOKEN to Doppler";
  }
  if (result.status === "error") {
    return `Unable to load ${what}: ${result.errorMessage ?? "unknown error"}`;
  }
  return `No ${what} available`;
}

export function SwarmiaNotConfiguredBanner() {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 px-5 py-4 text-sm text-foreground">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="font-medium">Swarmia is not configured yet.</p>
          <p className="text-muted-foreground">
            Add{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              SWARMIA_API_TOKEN
            </code>{" "}
            to Doppler (get a token from Swarmia → Settings → API tokens).
          </p>
        </div>
      </div>
    </div>
  );
}

export function formatMinutesAsHours(m: number): string {
  const h = m / 60;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} hr`;
  return `${(h / 24).toFixed(1)} d`;
}

export function formatDelta(
  current: number,
  comparison: number,
  unit = ""
): { change: string; trend: "up" | "down" | "flat" } {
  if (!Number.isFinite(comparison) || comparison === 0) {
    return { change: "", trend: "flat" };
  }
  const delta = current - comparison;
  const pct = (delta / comparison) * 100;
  const absDelta = Math.abs(delta);
  if (absDelta < 0.01) return { change: "flat vs 90d", trend: "flat" };
  const sign = delta > 0 ? "+" : "";
  return {
    change: `${sign}${pct.toFixed(0)}% vs 90d${unit}`,
    trend: delta > 0 ? "up" : "down",
  };
}
