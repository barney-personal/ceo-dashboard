import { describe, expect, it } from "vitest";

import { weeklyRetentionAggregator } from "../mode-aggregators";

describe("weeklyRetentionAggregator", () => {
  function aggregate(
    rows: Array<{
      cohort_week: string;
      relative_moving_week: string;
      active_users_weekly: string;
    }>,
  ) {
    let state = weeklyRetentionAggregator.initial();
    for (const row of rows) {
      state = weeklyRetentionAggregator.reduce(state, row);
    }
    return weeklyRetentionAggregator.finalize(state);
  }

  it("rolls up active_users_weekly across segment dimensions", () => {
    const result = aggregate([
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "0",
        active_users_weekly: "100",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "0",
        active_users_weekly: "50",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "1",
        active_users_weekly: "80",
      },
    ]);

    expect(result).toContainEqual({
      cohort_week: "2026-01-05",
      relative_moving_week: 0,
      active_users_weekly: 150,
    });
    expect(result).toContainEqual({
      cohort_week: "2026-01-05",
      relative_moving_week: 1,
      active_users_weekly: 80,
    });
  });

  it("skips rows with missing or non-numeric values", () => {
    const result = aggregate([
      {
        cohort_week: "",
        relative_moving_week: "0",
        active_users_weekly: "100",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "not-a-number",
        active_users_weekly: "10",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "0",
        active_users_weekly: "",
      },
      {
        cohort_week: "2026-01-05",
        relative_moving_week: "0",
        active_users_weekly: "42",
      },
    ]);

    expect(result).toEqual([
      {
        cohort_week: "2026-01-05",
        relative_moving_week: 0,
        active_users_weekly: 42,
      },
    ]);
  });

  it("declares the persisted column metadata", () => {
    expect(weeklyRetentionAggregator.columns).toEqual([
      { name: "cohort_week", type: "string" },
      { name: "relative_moving_week", type: "number" },
      { name: "active_users_weekly", type: "number" },
    ]);
  });

  it("normalises Mode CSV timestamps to UTC ISO so date parsing is timezone-stable", () => {
    const result = aggregate([
      {
        // Mode CSV emits this format with a space and no TZ marker.
        cohort_week: "2025-04-14 00:00:00.000",
        relative_moving_week: "0",
        active_users_weekly: "10",
      },
    ]);

    expect(result).toEqual([
      {
        cohort_week: "2025-04-14T00:00:00.000Z",
        relative_moving_week: 0,
        active_users_weekly: 10,
      },
    ]);
  });

  it("passes through already-ISO timestamps unchanged", () => {
    const result = aggregate([
      {
        cohort_week: "2025-04-14T00:00:00.000Z",
        relative_moving_week: "0",
        active_users_weekly: "5",
      },
    ]);

    expect(result[0].cohort_week).toBe("2025-04-14T00:00:00.000Z");
  });
});
