export type KrFormat = "percent" | "currency" | "integer" | "thousands";

export interface KrSnapshot {
  month: string; // ISO month e.g. "2026-02-01"
  value: number;
}

export interface ModeKr {
  level: "Company" | "Pillar" | "Squad";
  krType: string; // raw e.g. "Squad - Growth Marketing"
  squad: string | null; // stripped squad name if level === "Squad"
  pillar: string | null; // stripped pillar name if level === "Pillar"
  description: string;
  format: KrFormat;
  baseline: number | null;
  target: number | null;
  current: number | null; // latest snapshot value
  currentMonth: string | null;
  previous: number | null; // second-most-recent snapshot value
  previousMonth: string | null;
  snapshots: KrSnapshot[];
}

/**
 * Progress from baseline to target, clamped to [0, 1]. Returns null if unmeasurable.
 * Handles both "higher is better" (target > baseline) and "lower is better" (target < baseline).
 */
export function progressTowardTarget(kr: ModeKr): number | null {
  if (kr.baseline == null || kr.target == null || kr.current == null) {
    return null;
  }
  const span = kr.target - kr.baseline;
  if (span === 0) return kr.current >= kr.target ? 1 : 0;
  const raw = (kr.current - kr.baseline) / span;
  return Math.max(0, Math.min(1, raw));
}

export type KrTrend = "up" | "down" | "flat" | "unknown";

/**
 * Direction of the month-over-month change, as polarity relative to the target.
 * "up" means moving toward target; "down" means away.
 */
export function krTrend(kr: ModeKr): KrTrend {
  if (kr.current == null || kr.previous == null) return "unknown";
  const delta = kr.current - kr.previous;
  if (delta === 0) return "flat";
  if (kr.baseline == null || kr.target == null) {
    return delta > 0 ? "up" : "down";
  }
  const higherIsBetter = kr.target >= kr.baseline;
  const towardTarget = higherIsBetter ? delta > 0 : delta < 0;
  return towardTarget ? "up" : "down";
}

/** A KR is "tracked" in Mode if it has a latest measurement we can display. */
export function hasCurrentValue(kr: ModeKr): boolean {
  return kr.current != null;
}

/**
 * CEO-triage flag: a KR warrants attention if its numeric trajectory is concerning.
 * Either moving away from target, or already below 50% of the baseline→target span.
 * Returns false for KRs without enough data to judge (caller can filter separately).
 */
export function needsAttention(kr: ModeKr): boolean {
  if (kr.current == null) return false;
  if (krTrend(kr) === "down") return true;
  const progress = progressTowardTarget(kr);
  if (progress != null && progress < 0.5) return true;
  return false;
}

export function formatKrValue(value: number | null, format: KrFormat): string {
  if (value == null) return "—";
  if (format === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (format === "currency") {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
