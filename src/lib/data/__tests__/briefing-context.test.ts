import { describe, expect, it } from "vitest";
import type { OkrSummary } from "@/lib/data/okrs";
import {
  applyManagerFlagThreshold,
  normalisePillar,
  okrKeyMatchesPersonPillar,
  pickTopShips,
  relevantSectionsFor,
  summarisePillarOkrs,
  summariseSquadOkrs,
  type BriefingManagerFlag,
  type BriefingPerson,
  type BriefingShip,
} from "@/lib/data/briefing-helpers";

function makeOkr(overrides: Partial<OkrSummary> = {}): OkrSummary {
  return {
    pillar: "Growth",
    squadName: "Growth Onboarding",
    objectiveName: "Increase activation",
    krName: "KR1: Web→app open rate +20%",
    status: "on_track",
    actual: null,
    target: null,
    userName: null,
    postedAt: new Date("2026-04-20T10:00:00Z"),
    channelId: "C123",
    slackTs: "1745140000.000000",
    ...overrides,
  };
}

function makePerson(overrides: Partial<BriefingPerson> = {}): BriefingPerson {
  return {
    firstName: "Test",
    fullName: "Test Person",
    email: "test@meetcleo.com",
    jobTitle: "Engineer",
    squad: "Growth Onboarding",
    pillar: "Growth Pillar",
    function: "Engineering",
    tenureMonths: 12,
    role: "everyone",
    directReportCount: 0,
    ...overrides,
  };
}

describe("normalisePillar", () => {
  it("strips 'Pillar' suffix and lowercases", () => {
    expect(normalisePillar("Growth Pillar")).toBe("growth");
    expect(normalisePillar("Chat Pillar")).toBe("chat");
    expect(normalisePillar("Wealth Pillar")).toBe("wealth");
  });

  it("strips 'Decisioning' and 'Products' qualifiers", () => {
    expect(normalisePillar("Risk & Payments Decisioning")).toBe("risk payments");
    expect(normalisePillar("EWA & Credit Products Pillar")).toBe("ewa credit");
  });

  it("collapses punctuation to single spaces", () => {
    expect(normalisePillar("Access, Trust & Money")).toBe("access trust money");
  });

  it("handles empty input", () => {
    expect(normalisePillar("")).toBe("");
  });
});

describe("okrKeyMatchesPersonPillar", () => {
  it("matches when headcount suffix differs from OKR key", () => {
    expect(okrKeyMatchesPersonPillar("Growth", "Growth Pillar")).toBe(true);
    expect(okrKeyMatchesPersonPillar("Chat", "Chat Pillar")).toBe(true);
  });

  it("matches composite OKR keys for each constituent pillar", () => {
    // The real-world composite key from Slack OKR parsing
    const composite = "Access, Trust & Money, Risk & Payments";
    expect(okrKeyMatchesPersonPillar(composite, "Access, Trust & Money")).toBe(
      true,
    );
    expect(
      okrKeyMatchesPersonPillar(composite, "Risk & Payments Decisioning"),
    ).toBe(true);
  });

  it("does not match unrelated pillars", () => {
    expect(okrKeyMatchesPersonPillar("Growth", "Wealth Pillar")).toBe(false);
    expect(okrKeyMatchesPersonPillar("Chat", "New Bets Pillar")).toBe(false);
  });

  it("returns false for empty person pillar", () => {
    expect(okrKeyMatchesPersonPillar("Growth", "")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(okrKeyMatchesPersonPillar("GROWTH", "growth pillar")).toBe(true);
  });
});

describe("summarisePillarOkrs", () => {
  const now = new Date("2026-04-23T10:00:00Z");

  it("excludes the reader's own squad (that lives in squadOkrs instead)", () => {
    const okrs = [
      makeOkr({ squadName: "My Squad", status: "behind", postedAt: now }),
      makeOkr({ squadName: "Sibling Squad", status: "at_risk", postedAt: now }),
    ];
    const result = summarisePillarOkrs(okrs, "My Squad");
    expect(result.total).toBe(1);
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0].squad).toBe("Sibling Squad");
  });

  it("orders 'behind' before 'at_risk' before 'not_started' before 'on_track'", () => {
    const okrs = [
      makeOkr({ squadName: "A", status: "on_track", postedAt: now, krName: "K1" }),
      makeOkr({ squadName: "B", status: "at_risk", postedAt: now, krName: "K2" }),
      makeOkr({ squadName: "C", status: "behind", postedAt: now, krName: "K3" }),
      makeOkr({ squadName: "D", status: "not_started", postedAt: now, krName: "K4" }),
    ];
    const result = summarisePillarOkrs(okrs, "Reader Squad");
    expect(result.recent.map((o) => o.status)).toEqual([
      "behind",
      "at_risk",
      "not_started",
      "on_track",
    ]);
  });

  it("drops OKRs posted more than 14 days ago from 'recent'", () => {
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    // Freeze time by offsetting postedAt relative to Date.now(). The impl
    // compares against Date.now() so we use the fresh "recent" as a known-in.
    const okrs = [
      makeOkr({ squadName: "A", postedAt: old, krName: "old-kr" }),
      makeOkr({ squadName: "B", postedAt: recent, krName: "recent-kr" }),
    ];
    const result = summarisePillarOkrs(okrs, "Reader");
    expect(result.total).toBe(2); // counts include everything in the pillar
    expect(result.recent.map((o) => o.kr)).toEqual(["recent-kr"]);
  });

  it("produces status counts across the full sibling set", () => {
    const okrs = [
      makeOkr({ squadName: "A", status: "on_track" }),
      makeOkr({ squadName: "B", status: "on_track" }),
      makeOkr({ squadName: "C", status: "at_risk" }),
      makeOkr({ squadName: "D", status: "behind" }),
      makeOkr({ squadName: "E", status: "not_started" }),
    ];
    const result = summarisePillarOkrs(okrs, "Reader");
    expect(result).toMatchObject({
      total: 5,
      onTrack: 2,
      atRisk: 1,
      behind: 1,
      notStarted: 1,
    });
  });
});

describe("summariseSquadOkrs", () => {
  it("only includes the reader's own squad", () => {
    const okrs = [
      makeOkr({ squadName: "My Squad", krName: "mine-1" }),
      makeOkr({ squadName: "My Squad", krName: "mine-2" }),
      makeOkr({ squadName: "Other", krName: "theirs-1" }),
    ];
    const result = summariseSquadOkrs(okrs, "My Squad");
    expect(result.total).toBe(2);
    expect(result.recent.map((o) => o.kr)).toEqual(
      expect.arrayContaining(["mine-1", "mine-2"]),
    );
    expect(result.recent.every((o) => o.isSameSquad)).toBe(true);
  });

  it("matches squad name case-insensitively", () => {
    const okrs = [makeOkr({ squadName: "DAILY PLANS" })];
    const result = summariseSquadOkrs(okrs, "daily plans");
    expect(result.total).toBe(1);
  });
});

describe("relevantSectionsFor", () => {
  it("always includes Overview and OKRs", () => {
    const person = makePerson();
    const sections = relevantSectionsFor("everyone", person);
    expect(sections).toContain("Overview");
    expect(sections).toContain("OKRs");
  });

  it("adds Financial for ceo and leadership", () => {
    expect(relevantSectionsFor("ceo", makePerson())).toContain("Financial");
    expect(relevantSectionsFor("leadership", makePerson())).toContain(
      "Financial",
    );
    expect(relevantSectionsFor("everyone", makePerson())).not.toContain(
      "Financial",
    );
  });

  it("adds Unit Economics for growth and commercial roles", () => {
    expect(
      relevantSectionsFor(
        "everyone",
        makePerson({ pillar: "Growth Pillar", function: "Engineering" }),
      ),
    ).toContain("Unit Economics");
    expect(
      relevantSectionsFor(
        "everyone",
        makePerson({ pillar: "Commercial & Finance", function: "Commercial" }),
      ),
    ).toContain("Unit Economics");
  });

  it("adds Engineering for engineering / ML / data functions", () => {
    expect(
      relevantSectionsFor(
        "everyone",
        makePerson({ function: "Engineering" }),
      ),
    ).toContain("Engineering");
    expect(
      relevantSectionsFor(
        "everyone",
        makePerson({ function: "Machine Learning" }),
      ),
    ).toContain("Engineering");
  });

  it("adds Org and Talent for people-function roles", () => {
    const sections = relevantSectionsFor(
      "everyone",
      makePerson({ function: "People Operations", pillar: "People & Talent" }),
    );
    expect(sections).toContain("Org");
    expect(sections).toContain("Talent");
  });

  it("returns only base sections when person is null", () => {
    expect(relevantSectionsFor("everyone", null)).toEqual(["Overview"]);
  });
});

function makeShip(overrides: Partial<BriefingShip> = {}): BriefingShip {
  return {
    repo: "cleo/app",
    title: "feat: something",
    authorName: "Alice",
    mergedAtIso: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("pickTopShips", () => {
  it("prefers one ship per author before allowing a second", () => {
    const ships = [
      makeShip({ authorName: "Alice", mergedAtIso: "2026-04-22T10:00Z", title: "alice-2" }),
      makeShip({ authorName: "Alice", mergedAtIso: "2026-04-23T10:00Z", title: "alice-1" }),
      makeShip({ authorName: "Bob", mergedAtIso: "2026-04-21T10:00Z", title: "bob-1" }),
      makeShip({ authorName: "Carol", mergedAtIso: "2026-04-20T10:00Z", title: "carol-1" }),
    ];
    const result = pickTopShips(ships, 4);
    // First 3 slots are one per author (most recent first), then the second
    // Alice PR fills the remaining slot.
    expect(result.map((s) => s.title)).toEqual([
      "alice-1",
      "bob-1",
      "carol-1",
      "alice-2",
    ]);
  });

  it("caps at `limit`", () => {
    const ships = Array.from({ length: 10 }, (_, i) =>
      makeShip({
        authorName: `Author${i}`,
        title: `ship-${i}`,
        mergedAtIso: `2026-04-${String(10 + i).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    expect(pickTopShips(ships, 3)).toHaveLength(3);
  });

  it("returns an empty array when given none", () => {
    expect(pickTopShips([], 5)).toEqual([]);
  });
});

function makeFlag(overrides: Partial<BriefingManagerFlag> = {}): BriefingManagerFlag {
  return {
    name: "Test",
    rank: 50,
    percentile: 50,
    confidenceHigh: 60,
    squad: "Chat",
    snapshotDate: "2026-04-23",
    ...overrides,
  };
}

describe("applyManagerFlagThreshold", () => {
  it("flags reports in the bottom quintile with a tight upper CI", () => {
    const flagged = applyManagerFlagThreshold([
      makeFlag({ name: "Low+Tight", percentile: 8, confidenceHigh: 25 }),
      makeFlag({ name: "Mid", percentile: 55, confidenceHigh: 70 }),
    ]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].name).toBe("Low+Tight");
  });

  it("omits reports with wide confidence bands even if percentile is low", () => {
    const flagged = applyManagerFlagThreshold([
      makeFlag({ name: "Low+Wide", percentile: 8, confidenceHigh: 60 }),
    ]);
    // Upper CI reaches mid-cohort — noise too high to call out.
    expect(flagged).toEqual([]);
  });

  it("orders flagged reports by percentile ascending (most severe first)", () => {
    const flagged = applyManagerFlagThreshold([
      makeFlag({ name: "B", percentile: 15, confidenceHigh: 30 }),
      makeFlag({ name: "A", percentile: 5, confidenceHigh: 20 }),
      makeFlag({ name: "C", percentile: 18, confidenceHigh: 32 }),
    ]);
    expect(flagged.map((f) => f.name)).toEqual(["A", "B", "C"]);
  });

  it("caps at most three reports", () => {
    const input = Array.from({ length: 6 }, (_, i) =>
      makeFlag({ name: `R${i}`, percentile: i + 1, confidenceHigh: i + 10 }),
    );
    expect(applyManagerFlagThreshold(input)).toHaveLength(3);
  });

  it("drops reports with null percentile or null confidence", () => {
    const flagged = applyManagerFlagThreshold([
      makeFlag({ name: "NoPct", percentile: null, confidenceHigh: 20 }),
      makeFlag({ name: "NoCI", percentile: 5, confidenceHigh: null }),
    ]);
    expect(flagged).toEqual([]);
  });
});
