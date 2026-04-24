import { describe, expect, it } from "vitest";
import {
  canonicalDepartment,
  classifyTenureBucket,
  getAttritionByDepartment,
  getDepartments,
  type AttritionRow,
} from "../attrition-utils";

function row(over: Partial<AttritionRow>): AttritionRow {
  return {
    reportingPeriod: "2026-04-01",
    department: "Engineering",
    tenure: "< 1 Year",
    headcountAvg: 10,
    avgHeadcountL12m: 10,
    leaversL12m: 0,
    regrettedL12m: 0,
    voluntaryNonRegrettedL12m: 0,
    involuntaryL12m: 0,
    ...over,
  };
}

describe("classifyTenureBucket", () => {
  it.each([
    ["< 1 Year", "sub1yr"],
    ["<1yr", "sub1yr"],
    ["< 1y", "sub1yr"],
    ["0-3m", "sub1yr"],
    ["3-6m", "sub1yr"],
    ["9-12m", "sub1yr"],
  ] as const)("classifies %s as <1yr", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it.each([
    ["1+ Year", "over1yr"],
    ["> 1 Year", "over1yr"],
    [">1yr", "over1yr"],
    ["1 +", "over1yr"],
  ] as const)("classifies %s as >=1yr", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it.each([
    ["", "unknown"],
    ["Unknown", "unknown"],
    ["???", "unknown"],
  ] as const)("classifies %s as unknown", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it("is case-insensitive and trim-tolerant", () => {
    expect(classifyTenureBucket("  < 1 YEAR  ")).toBe("sub1yr");
    expect(classifyTenureBucket("  1+ YEAR  ")).toBe("over1yr");
  });
});

describe("canonicalDepartment", () => {
  it("rewrites legacy names to their canonical dept", () => {
    expect(canonicalDepartment("Design")).toBe("Experience");
    expect(canonicalDepartment("Software")).toBe("Engineering");
    expect(canonicalDepartment("Talent")).toBe("People");
    expect(canonicalDepartment("Workplace Experience")).toBe("People");
    expect(canonicalDepartment("CEO Office")).toBe("Strategy & Operations");
    expect(canonicalDepartment("Commercial")).toBe("Product Performance");
    expect(canonicalDepartment("Fraud")).toBe("Credit");
  });

  it("passes through unmapped names unchanged", () => {
    expect(canonicalDepartment("Engineering")).toBe("Engineering");
    expect(canonicalDepartment("Customer Ops")).toBe("Customer Ops");
    expect(canonicalDepartment("")).toBe("");
  });
});

describe("getDepartments", () => {
  it("sorts by headcount desc and rounds avgHeadcountL12m", () => {
    const rows: AttritionRow[] = [
      row({ department: "Marketing", tenure: "< 1 Year", avgHeadcountL12m: 3.2 }),
      row({ department: "Marketing", tenure: "1+ Year", avgHeadcountL12m: 4.8 }),
      row({ department: "Engineering", tenure: "< 1 Year", avgHeadcountL12m: 50 }),
      row({ department: "Engineering", tenure: "1+ Year", avgHeadcountL12m: 60 }),
    ];
    expect(getDepartments(rows)).toEqual([
      { name: "Engineering", headcount: 110 },
      { name: "Marketing", headcount: 8 },
    ]);
  });

  it("skips zero-headcount departments and 'All' rollup rows", () => {
    const rows: AttritionRow[] = [
      row({ department: "Engineering", avgHeadcountL12m: 10 }),
      row({ department: "Zombie", avgHeadcountL12m: 0 }),
      row({ department: "All", avgHeadcountL12m: 999 }),
      row({ department: "Engineering", tenure: "All", avgHeadcountL12m: 999 }),
    ];
    expect(getDepartments(rows).map((d) => d.name)).toEqual(["Engineering"]);
  });

  it("uses the single latest reporting period across departments", () => {
    const rows: AttritionRow[] = [
      row({ department: "Engineering", reportingPeriod: "2026-04-01", avgHeadcountL12m: 5 }),
      row({ department: "Old", reportingPeriod: "2025-01-01", avgHeadcountL12m: 20 }),
    ];
    expect(getDepartments(rows).map((d) => d.name)).toEqual(["Engineering"]);
  });
});

describe("getAttritionByDepartment", () => {
  it("returns at most 8 series (top departments by headcount)", () => {
    const rows: AttritionRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(
        row({
          department: `Dept${String(i).padStart(2, "0")}`,
          // Lower i → larger headcount, so Dept00..Dept07 should survive the cap.
          avgHeadcountL12m: 100 - i,
          leaversL12m: 1,
        }),
      );
    }
    const series = getAttritionByDepartment(rows);
    expect(series).toHaveLength(8);
    expect(series.map((s) => s.label)).toEqual([
      "Dept00", "Dept01", "Dept02", "Dept03",
      "Dept04", "Dept05", "Dept06", "Dept07",
    ]);
  });
});
