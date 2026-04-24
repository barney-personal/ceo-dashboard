import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/hc-plan.json", () => ({
  default: {
    snapshotDate: "2026-04-24",
    source: "https://example.test/sheet",
    sourceTab: "HC working sheet (Latest)",
    note: "test fixture",
    teams: [
      // Customer Success rows — must be stripped.
      {
        department: "Customer Success",
        team: "Champs",
        type: "Existing",
        currentEmployees: 10,
        hiredOfferOut: 0,
        inPipeline: 5,
        t2Hire: 0,
        totalHc: 15,
        pctTotalHc: 0,
        decisions: null,
      },
      // Plain match — pillar exists in Mode by exact name.
      {
        department: "Chat Pillar",
        team: "Chat - Daily Plans",
        type: "Existing",
        currentEmployees: 19,
        hiredOfferOut: 1,
        inPipeline: 2,
        t2Hire: 3,
        totalHc: 25,
        pctTotalHc: 0,
        decisions: null,
      },
      // Same pillar, second team — should aggregate.
      {
        department: "Chat Pillar",
        team: "Chat - Autopilot",
        type: "Existing",
        currentEmployees: 11,
        hiredOfferOut: 4,
        inPipeline: 0,
        t2Hire: 0,
        totalHc: 15,
        pctTotalHc: 0,
        decisions: null,
      },
      // Casing mismatch — Mode says "Win On Data", sheet says "Win on Data".
      {
        department: "Win on Data",
        team: "Insights",
        type: "Existing",
        currentEmployees: 8,
        hiredOfferOut: 0,
        inPipeline: 1,
        t2Hire: 0,
        totalHc: 9,
        pctTotalHc: 0,
        decisions: null,
      },
      // No matching Mode pillar — should land in unmatched.
      {
        department: "Mystery Pillar",
        team: "Solo",
        type: "New squad",
        currentEmployees: 0,
        hiredOfferOut: 2,
        inPipeline: 0,
        t2Hire: 1,
        totalHc: 3,
        pctTotalHc: 0,
        decisions: null,
      },
      // Eng Temp — handled inline when caller registers it as a pseudo-pillar.
      {
        department: "Engineering (Temp)",
        team: "Engineering (Temp)",
        type: "Existing",
        currentEmployees: 11,
        hiredOfferOut: 13,
        inPipeline: 0,
        t2Hire: 0,
        totalHc: 24,
        pctTotalHc: 0,
        decisions: null,
      },
    ],
  },
}));

// Imports must come AFTER the mock declaration.
import {
  getHcPlan,
  getHcPlanTotals,
  reconcileHcPlanByPillar,
} from "../hc-plan";

describe("hc-plan loader", () => {
  it("strips Customer Success rows from the included teams", () => {
    const plan = getHcPlan();
    expect(plan.teams.find((t) => t.department === "Customer Success")).toBeUndefined();
    // Sanity: non-CS teams remain.
    expect(plan.teams.some((t) => t.department === "Chat Pillar")).toBe(true);
  });

  it("computes totals over the CS-stripped fixture", () => {
    const totals = getHcPlanTotals();
    // Sum of Chat Pillar (19+11=30) + Win on Data (8) + Mystery (0) + Eng Temp (11)
    expect(totals.currentEmployees).toBe(49);
    // Hired/offer: Chat (1+4) + Win (0) + Mystery (2) + Eng Temp (13)
    expect(totals.hiredOfferOut).toBe(20);
    // In pipeline: Chat (2+0) + Win (1) + Mystery (0) + Eng Temp (0)
    expect(totals.inPipeline).toBe(3);
    // T2: Chat (3+0) + Win (0) + Mystery (1) + Eng Temp (0)
    expect(totals.t2Hire).toBe(4);
  });
});

describe("reconcileHcPlanByPillar", () => {
  it("joins Mode pillars to sheet departments by exact name", () => {
    const result = reconcileHcPlanByPillar([{ name: "Chat Pillar", count: 55 }]);
    const chat = result.pillars.find((p) => p.pillar === "Chat Pillar");
    expect(chat).toBeDefined();
    expect(chat!.currentEmployees).toBe(55); // from Mode, not from the sheet
    expect(chat!.hiredOfferOut).toBe(5); // 1 + 4 across two Chat teams
    expect(chat!.inPipeline).toBe(2);
    expect(chat!.t2Hire).toBe(3);
    expect(chat!.totalHc).toBe(55 + 5 + 2 + 3);
    expect(chat!.matchedSheet).toBe(true);
    expect(chat!.teams).toHaveLength(2);
  });

  it("matches by normalised name (case + punctuation insensitive)", () => {
    const result = reconcileHcPlanByPillar([{ name: "Win On Data", count: 30 }]);
    const wod = result.pillars.find((p) => p.pillar === "Win On Data");
    expect(wod).toBeDefined();
    expect(wod!.matchedSheet).toBe(true);
    expect(wod!.inPipeline).toBe(1);
  });

  it("returns Mode pillar with zero deltas when no sheet department matches", () => {
    const result = reconcileHcPlanByPillar([
      { name: "Pillar With No Sheet Row", count: 12 },
    ]);
    const pillar = result.pillars.find(
      (p) => p.pillar === "Pillar With No Sheet Row"
    );
    expect(pillar).toBeDefined();
    expect(pillar!.matchedSheet).toBe(false);
    expect(pillar!.hiredOfferOut).toBe(0);
    expect(pillar!.inPipeline).toBe(0);
    expect(pillar!.t2Hire).toBe(0);
    expect(pillar!.totalHc).toBe(12);
  });

  it("surfaces sheet departments that don't match any Mode pillar", () => {
    const result = reconcileHcPlanByPillar([{ name: "Chat Pillar", count: 55 }]);
    expect(
      result.unmatchedSheetDepartments.some((d) => d.department === "Mystery Pillar")
    ).toBe(true);
    // Engineering (Temp) is unmatched here too because no Mode pseudo-pillar
    // was registered in this test case.
    expect(
      result.unmatchedSheetDepartments.some(
        (d) => d.department === "Engineering (Temp)"
      )
    ).toBe(true);
  });

  it("includes unmatched sheet hires in headline totals", () => {
    const result = reconcileHcPlanByPillar([{ name: "Chat Pillar", count: 55 }]);
    // Today: only matched Chat Pillar count
    expect(result.totals.currentEmployees).toBe(55);
    // Future hires include unmatched (Mystery: 2+0+1=3, Eng Temp: 13+0+0=13)
    // plus matched Chat (5+2+3=10) and Win on Data is unmatched too (0+1+0=1)
    expect(result.totals.hiredOfferOut).toBe(5 + 0 + 2 + 13);
    expect(result.totals.inPipeline).toBe(2 + 1 + 0 + 0);
    expect(result.totals.t2Hire).toBe(3 + 0 + 1 + 0);
  });

  it("treats Engineering (Temp) as a pseudo-pillar when registered with count=0", () => {
    const result = reconcileHcPlanByPillar([
      { name: "Chat Pillar", count: 55 },
      { name: "Engineering (Temp)", count: 0 },
    ]);
    const engTemp = result.pillars.find(
      (p) => p.pillar === "Engineering (Temp)"
    );
    expect(engTemp).toBeDefined();
    expect(engTemp!.currentEmployees).toBe(0); // from the pseudo-pillar input
    expect(engTemp!.hiredOfferOut).toBe(13); // from the sheet row
    expect(engTemp!.totalHc).toBe(13);
    expect(engTemp!.matchedSheet).toBe(true);
    // Once matched, Eng Temp should NOT also show up in unmatched.
    expect(
      result.unmatchedSheetDepartments.some(
        (d) => d.department === "Engineering (Temp)"
      )
    ).toBe(false);
  });

  it("sorts pillars by total descending", () => {
    const result = reconcileHcPlanByPillar([
      { name: "Chat Pillar", count: 55 },
      { name: "Win On Data", count: 30 },
      { name: "Engineering (Temp)", count: 0 },
    ]);
    const totals = result.pillars.map((p) => p.totalHc);
    const sorted = [...totals].sort((a, b) => b - a);
    expect(totals).toEqual(sorted);
  });
});
