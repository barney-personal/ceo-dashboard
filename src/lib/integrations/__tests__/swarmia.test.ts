import { describe, expect, it } from "vitest";
import { parseCsv } from "../swarmia";

describe("parseCsv", () => {
  it("parses a simple DORA-shaped response", () => {
    const csv =
      "Start Date,End Date,Deployment Frequency (per day),Change Failure Rate (%)\n" +
      "2026-03-17,2026-04-15,40.7,1.39";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Start Date"]).toBe("2026-03-17");
    expect(rows[0]["Deployment Frequency (per day)"]).toBe("40.7");
    expect(rows[0]["Change Failure Rate (%)"]).toBe("1.39");
  });

  it("handles quoted fields containing commas", () => {
    // Swarmia emits parent team names with commas wrapped in quotes, e.g.
    // `"Access, Trust & Money Pillar",Fraud Infrastructure,...`
    const csv =
      "Parent Team(s),Team,Contributors\n" +
      '"Access, Trust & Money Pillar",Fraud Infrastructure,8';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Parent Team(s)"]).toBe("Access, Trust & Money Pillar");
    expect(rows[0]["Team"]).toBe("Fraud Infrastructure");
    expect(rows[0]["Contributors"]).toBe("8");
  });

  it("returns empty array when only a header is present", () => {
    expect(parseCsv("Start Date,End Date\n")).toEqual([]);
  });

  it("returns empty array on blank input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  \n")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const csv = "a,b\r\n1,2\r\n3,4";
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("fills missing trailing cells with empty strings", () => {
    // Pillar-level rows leave the Parent Team(s) column empty.
    const csv = "Parent Team(s),Team,Count\n,Chat Pillar,20";
    const rows = parseCsv(csv);
    expect(rows[0]["Parent Team(s)"]).toBe("");
    expect(rows[0]["Team"]).toBe("Chat Pillar");
    expect(rows[0]["Count"]).toBe("20");
  });

  it("skips blank body lines rather than producing empty-string rows", () => {
    // Trailing newlines or blank rows between data would otherwise become
    // rows where every value is "" (which toNumber would coerce to 0).
    const csv = "a,b\n1,2\n\n3,4\n";
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });
});
