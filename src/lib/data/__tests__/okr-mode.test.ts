import { describe, expect, it } from "vitest";
import {
  buildModeKrs,
  formatKrValue,
  hasCurrentValue,
  krTrend,
  needsAttention,
  progressTowardTarget,
  type ModeKr,
} from "../okr-mode";

function row(partial: Record<string, unknown>) {
  return {
    kr_level: "Company",
    kr_type: "Company",
    kr_description: "User Acquisition",
    kr_baseline_value: 236000,
    kr_target_value: 306000,
    kr_current_value: 300000,
    format: "k",
    reporting_month: "2026-02-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildModeKrs", () => {
  it("groups snapshots by KR and sorts chronologically", () => {
    const krs = buildModeKrs([
      row({
        reporting_month: "2026-03-01T00:00:00.000Z",
        kr_current_value: 229430,
      }),
      row({
        reporting_month: "2026-01-01T00:00:00.000Z",
        kr_current_value: 309228,
      }),
      row({
        reporting_month: "2026-02-01T00:00:00.000Z",
        kr_current_value: 243366,
      }),
    ]);

    expect(krs).toHaveLength(1);
    const kr = krs[0];
    expect(kr.snapshots.map((s) => s.month)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(kr.current).toBe(229430);
    expect(kr.currentMonth).toBe("2026-03-01");
    expect(kr.previous).toBe(243366);
    expect(kr.baseline).toBe(236000);
    expect(kr.target).toBe(306000);
  });

  it("strips Squad - prefix into squad name", () => {
    const krs = buildModeKrs([
      row({ kr_level: "Squad", kr_type: "Squad - Growth Marketing" }),
    ]);
    expect(krs[0].level).toBe("Squad");
    expect(krs[0].squad).toBe("Growth Marketing");
  });

  it("strips Pillar - prefix into pillar name", () => {
    const krs = buildModeKrs([
      row({ kr_level: "Pillar", kr_type: "Pillar - Growth" }),
    ]);
    expect(krs[0].pillar).toBe("Growth");
  });

  it("infers format from the format string", () => {
    expect(
      buildModeKrs([row({ format: "0.00%" })])[0].format,
    ).toBe("percent");
    expect(buildModeKrs([row({ format: "$" })])[0].format).toBe("currency");
    expect(buildModeKrs([row({ format: "k" })])[0].format).toBe("thousands");
    expect(buildModeKrs([row({ format: "0" })])[0].format).toBe("integer");
  });

  it("skips rows missing level/type/description", () => {
    expect(buildModeKrs([row({ kr_level: "" })])).toHaveLength(0);
    expect(buildModeKrs([row({ kr_description: "" })])).toHaveLength(0);
  });

  it("skips snapshot entries missing month or value but still registers the KR", () => {
    const krs = buildModeKrs([
      row({ reporting_month: "", kr_current_value: null }),
    ]);
    expect(krs).toHaveLength(1);
    expect(krs[0].snapshots).toEqual([]);
    expect(krs[0].current).toBeNull();
  });

  it("backfills baseline/target from later rows if first row lacks them", () => {
    const krs = buildModeKrs([
      row({
        kr_baseline_value: null,
        kr_target_value: null,
        reporting_month: "2026-01-01T00:00:00.000Z",
      }),
      row({ reporting_month: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(krs[0].baseline).toBe(236000);
    expect(krs[0].target).toBe(306000);
  });
});

describe("progressTowardTarget", () => {
  it("computes fraction from baseline to target", () => {
    const kr = buildModeKrs([row({ kr_current_value: 271000 })])[0];
    expect(progressTowardTarget(kr)).toBeCloseTo(0.5, 2);
  });

  it("clamps to [0, 1]", () => {
    const above = buildModeKrs([row({ kr_current_value: 400000 })])[0];
    expect(progressTowardTarget(above)).toBe(1);
    const below = buildModeKrs([row({ kr_current_value: 100000 })])[0];
    expect(progressTowardTarget(below)).toBe(0);
  });

  it("handles lower-is-better KRs (target < baseline)", () => {
    const kr = buildModeKrs([
      row({
        kr_baseline_value: 0.13,
        kr_target_value: 0.1,
        kr_current_value: 0.115,
        format: "$",
      }),
    ])[0];
    expect(progressTowardTarget(kr)).toBeCloseTo(0.5, 2);
  });

  it("returns null when any of baseline/target/current is missing", () => {
    const kr: ModeKr = buildModeKrs([
      row({ kr_current_value: null, reporting_month: "" }),
    ])[0];
    expect(progressTowardTarget(kr)).toBeNull();
  });
});

describe("krTrend", () => {
  it("returns up when moving toward target", () => {
    const kr = buildModeKrs([
      row({
        reporting_month: "2026-01-01T00:00:00.000Z",
        kr_current_value: 240000,
      }),
      row({
        reporting_month: "2026-02-01T00:00:00.000Z",
        kr_current_value: 260000,
      }),
    ])[0];
    expect(krTrend(kr)).toBe("up");
  });

  it("returns down when moving away from target", () => {
    const kr = buildModeKrs([
      row({
        reporting_month: "2026-01-01T00:00:00.000Z",
        kr_current_value: 260000,
      }),
      row({
        reporting_month: "2026-02-01T00:00:00.000Z",
        kr_current_value: 240000,
      }),
    ])[0];
    expect(krTrend(kr)).toBe("down");
  });

  it("returns up for lower-is-better KRs that decrease", () => {
    const kr = buildModeKrs([
      row({
        kr_baseline_value: 0.13,
        kr_target_value: 0.1,
        kr_current_value: 0.12,
        format: "$",
        reporting_month: "2026-01-01T00:00:00.000Z",
      }),
      row({
        kr_baseline_value: 0.13,
        kr_target_value: 0.1,
        kr_current_value: 0.11,
        format: "$",
        reporting_month: "2026-02-01T00:00:00.000Z",
      }),
    ])[0];
    expect(krTrend(kr)).toBe("up");
  });

  it("returns unknown without two snapshots", () => {
    const kr = buildModeKrs([row({})])[0];
    expect(krTrend(kr)).toBe("unknown");
  });
});

describe("hasCurrentValue", () => {
  it("is true when a current snapshot exists", () => {
    const kr = buildModeKrs([row({})])[0];
    expect(hasCurrentValue(kr)).toBe(true);
  });

  it("is false when no snapshot has a value", () => {
    const kr = buildModeKrs([
      row({ reporting_month: "", kr_current_value: null }),
    ])[0];
    expect(hasCurrentValue(kr)).toBe(false);
  });
});

describe("needsAttention", () => {
  it("flags a KR trending down even if progress is high", () => {
    const kr = buildModeKrs([
      row({
        reporting_month: "2026-01-01T00:00:00.000Z",
        kr_current_value: 300000,
      }),
      row({
        reporting_month: "2026-02-01T00:00:00.000Z",
        kr_current_value: 290000,
      }),
    ])[0];
    expect(needsAttention(kr)).toBe(true);
  });

  it("flags a KR below 50% progress", () => {
    const kr = buildModeKrs([
      row({ kr_current_value: 240000 }), // baseline 236k, target 306k → ~6%
    ])[0];
    expect(needsAttention(kr)).toBe(true);
  });

  it("does not flag a KR trending up and above 50%", () => {
    const kr = buildModeKrs([
      row({
        reporting_month: "2026-01-01T00:00:00.000Z",
        kr_current_value: 270000, // ~48% (not enough on its own)
      }),
      row({
        reporting_month: "2026-02-01T00:00:00.000Z",
        kr_current_value: 285000, // ~70%, trending up
      }),
    ])[0];
    expect(needsAttention(kr)).toBe(false);
  });

  it("does not flag a KR without a current value", () => {
    const kr = buildModeKrs([
      row({ reporting_month: "", kr_current_value: null }),
    ])[0];
    expect(needsAttention(kr)).toBe(false);
  });
});

describe("formatKrValue", () => {
  it("formats percentages", () => {
    expect(formatKrValue(0.5349446623, "percent")).toBe("53.5%");
  });

  it("formats currency", () => {
    expect(formatKrValue(125.63, "currency")).toBe("$125.63");
  });

  it("formats thousands with commas", () => {
    expect(formatKrValue(309228, "thousands")).toBe("309,228");
  });

  it("formats integers", () => {
    expect(formatKrValue(4000, "integer")).toBe("4,000");
  });

  it("renders em dash for null", () => {
    expect(formatKrValue(null, "percent")).toBe("—");
  });
});
