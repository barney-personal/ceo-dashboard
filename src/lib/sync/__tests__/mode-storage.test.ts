import { describe, expect, it } from "vitest";
import {
  getModeQuerySyncProfile,
  prepareModeRowsForStorage,
  shouldSyncModeReport,
} from "@/lib/sync/mode-storage";

describe("mode storage profiles", () => {
  it("does not sync embed-only reports", () => {
    // Seasonality Overview remains embed-only
    expect(shouldSyncModeReport("10b1f099768d")).toBe(false);
    // Retention Dashboard, Premium Conversion, and Strategic Finance KPIs are synced
    expect(shouldSyncModeReport("9c02ab407985")).toBe(true);
    expect(shouldSyncModeReport("76bc42f598a7")).toBe(true);
    expect(shouldSyncModeReport("11c3172037ac")).toBe(true);
  });

  it("finds configured query profiles", () => {
    const query = getModeQuerySyncProfile("11c3172037ac", "Query 3");
    expect(query?.storageWindow.kind).toBe("since-date");
  });

  it("trims daily rows by configured since-date window", () => {
    const queryProfile = getModeQuerySyncProfile("11c3172037ac", "Query 3");
    expect(queryProfile).toBeDefined();

    const prepared = prepareModeRowsForStorage(
      [
        { day: "2022-12-31", spend: 1 },
        { day: "2023-01-01", spend: 2 },
        { day: "2024-01-01", spend: 3 },
      ],
      queryProfile!
    );

    expect(prepared.sourceRowCount).toBe(3);
    expect(prepared.storedRowCount).toBe(2);
    expect(prepared.truncated).toBe(true);
    expect(prepared.rows).toEqual([
      { day: "2023-01-01", spend: 2 },
      { day: "2024-01-01", spend: 3 },
    ]);
  });

  it("keeps the last N cohorts for retention data", () => {
    const prepared = prepareModeRowsForStorage(
      [
        { cohort_month: "2024-01-01", value: 1 },
        { cohort_month: "2024-02-01", value: 2 },
        { cohort_month: "2024-03-01", value: 3 },
      ],
      {
        name: "Query 1",
        storageWindow: {
          kind: "last-cohorts",
          field: "cohort_month",
          count: 2,
        },
      }
    );

    expect(prepared.rows).toEqual([
      { cohort_month: "2024-02-01", value: 2 },
      { cohort_month: "2024-03-01", value: 3 },
    ]);
    expect(prepared.truncated).toBe(true);
  });
});
