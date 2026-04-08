import { describe, expect, it } from "vitest";
import {
  getMonthlyJoinersAndDepartures,
  getPeopleMetrics,
  isActiveCleoEmployeeRow,
  isTerminatedCleoEmployeeRow,
  transformToPersons,
} from "../people";

describe("headcount row helpers", () => {
  it("treats lowercase employed rows as active Cleo headcount", () => {
    expect(
      isActiveCleoEmployeeRow({
        lifecycle_status: "employed",
        is_cleo_headcount: 1,
      })
    ).toBe(true);
  });

  it("treats string truthy headcount flags as active Cleo headcount", () => {
    expect(
      isActiveCleoEmployeeRow({
        lifecycle_status: "Employed",
        is_cleo_headcount: "1",
      })
    ).toBe(true);
  });

  it("treats terminated rows case-insensitively", () => {
    expect(
      isTerminatedCleoEmployeeRow({
        lifecycle_status: "terminated",
        is_cleo_headcount: "true",
      })
    ).toBe(true);
  });
});

describe("people metrics", () => {
  it("counts active employees and departures with normalized headcount rows", () => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const active = transformToPersons([
      {
        preferred_name: "A. Example",
        lifecycle_status: "employed",
        is_cleo_headcount: 1,
        start_date: fifteenDaysAgo,
        hb_function: "Engineering",
      },
      {
        preferred_name: "B. Example",
        lifecycle_status: "Employed",
        is_cleo_headcount: "1",
        start_date: thirtyDaysAgo,
        hb_function: "Product",
      },
    ]);

    const metrics = getPeopleMetrics(active, [
      {
        lifecycle_status: "terminated",
        is_cleo_headcount: "1",
        termination_date: fifteenDaysAgo,
      },
    ]);

    expect(metrics.total).toBe(2);
    expect(metrics.departments).toBe(2);
    expect(metrics.attritionLast90Days).toBe(1);
  });

  it("counts joiners from string headcount flags", () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2)
      .toISOString()
      .slice(0, 10);

    const movement = getMonthlyJoinersAndDepartures([
      {
        is_cleo_headcount: "1",
        start_date: thisMonth,
      },
    ], 1);

    expect(movement.joiners[0]?.value).toBe(1);
  });
});
