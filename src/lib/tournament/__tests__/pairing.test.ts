import { describe, expect, it } from "vitest";
import {
  pairKey,
  selectNextPair,
  selectRandomPair,
  type PairingEngineer,
} from "../pairing";

function deterministicRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function engineer(
  email: string,
  rating: number,
  judgmentsPlayed = 0,
): PairingEngineer {
  return { email, rating, judgmentsPlayed };
}

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey("a@x.com", "b@x.com")).toBe(pairKey("b@x.com", "a@x.com"));
  });

  it("is case-insensitive", () => {
    expect(pairKey("A@x.com", "b@x.com")).toBe(pairKey("a@x.com", "B@x.com"));
  });
});

describe("selectRandomPair (legacy)", () => {
  it("never selects self-pair", () => {
    const emails = ["a@x.com", "b@x.com", "c@x.com"];
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const pair = selectRandomPair(emails, counts);
      expect(pair.aEmail).not.toBe(pair.bEmail);
    }
  });

  it("throws when fewer than 2 engineers", () => {
    expect(() => selectRandomPair(["a@x.com"], new Map())).toThrow();
  });
});

describe("selectNextPair — min-matches floor", () => {
  it("pairs two below-floor engineers when both exist", () => {
    const engineers = [
      engineer("a@x", 1500, 0),
      engineer("b@x", 1500, 0),
      engineer("c@x", 1500, 10),
      engineer("d@x", 1500, 10),
    ];
    const pair = selectNextPair(engineers, new Map(), { minMatchesFloor: 5 })!;
    const emails = new Set([pair.aEmail, pair.bEmail]);
    expect(emails).toEqual(new Set(["a@x", "b@x"]));
  });

  it("pairs the lone below-floor engineer with closest-rated when only one exists", () => {
    const engineers = [
      engineer("low@x", 1500, 0),
      engineer("near@x", 1505, 10),
      engineer("far@x", 1900, 10),
    ];
    const pair = selectNextPair(engineers, new Map(), { minMatchesFloor: 5 })!;
    expect([pair.aEmail, pair.bEmail].includes("low@x")).toBe(true);
    // Closest-rated should win: near@x (Δ5) over far@x (Δ400).
    expect([pair.aEmail, pair.bEmail].includes("near@x")).toBe(true);
  });

  it("avoids re-pairing when the low-judgment engineer has played a candidate before", () => {
    const engineers = [
      engineer("low@x", 1500, 0),
      engineer("c1@x", 1505, 10),
      engineer("c2@x", 1510, 10),
    ];
    const counts = new Map<string, number>([
      [pairKey("low@x", "c1@x"), 1],
    ]);
    const pair = selectNextPair(engineers, counts, { minMatchesFloor: 5 })!;
    expect([pair.aEmail, pair.bEmail].includes("c2@x")).toBe(true);
  });
});

describe("selectNextPair — Swiss pairing once everyone is above floor", () => {
  it("prefers near-rated pairs over wide-rating gaps", () => {
    const engineers = [
      engineer("top@x", 1700, 10),
      engineer("near-top@x", 1680, 10),
      engineer("middle@x", 1500, 10),
      engineer("near-bot@x", 1320, 10),
      engineer("bot@x", 1300, 10),
    ];
    // Run many trials with deterministic anchor selection covering each anchor.
    const observed = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const pair = selectNextPair(engineers, new Map(), {
        minMatchesFloor: 5,
        swissBandSize: 1,
      });
      if (pair) observed.add(pairKey(pair.aEmail, pair.bEmail));
    }
    // band=1 means only adjacent pairs in rating order are valid.
    expect(observed.has(pairKey("top@x", "near-top@x"))).toBe(true);
    expect(observed.has(pairKey("bot@x", "near-bot@x"))).toBe(true);
    // Top should never end up paired with bottom under band=1.
    expect(observed.has(pairKey("top@x", "bot@x"))).toBe(false);
  });

  it("returns unseen pairs over already-played ones at similar ratings", () => {
    const engineers = [
      engineer("a@x", 1600, 10),
      engineer("b@x", 1605, 10),
      engineer("c@x", 1610, 10),
    ];
    const counts = new Map<string, number>([
      // Below the rematch cap so they remain candidates, just suboptimal.
      [pairKey("a@x", "b@x"), 3],
      [pairKey("b@x", "c@x"), 3],
    ]);
    const observed = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pair = selectNextPair(engineers, counts, {
        minMatchesFloor: 5,
        swissBandSize: 4,
      });
      if (pair) observed.add(pairKey(pair.aEmail, pair.bEmail));
    }
    expect(observed.has(pairKey("a@x", "c@x"))).toBe(true);
    expect(observed.size).toBe(1);
  });
});

describe("selectNextPair — robustness", () => {
  it("never selects self-pair", () => {
    const engineers = [
      engineer("a@x", 1500, 10),
      engineer("b@x", 1500, 10),
    ];
    for (let i = 0; i < 200; i++) {
      const pair = selectNextPair(engineers, new Map());
      expect(pair).not.toBeNull();
      expect(pair!.aEmail).not.toBe(pair!.bEmail);
    }
  });

  it("throws when fewer than 2 engineers", () => {
    expect(() => selectNextPair([engineer("solo@x", 1500, 0)], new Map())).toThrow();
  });

  it("works with deterministic rng", () => {
    const engineers = [
      engineer("a@x", 1700, 10),
      engineer("b@x", 1500, 10),
      engineer("c@x", 1300, 10),
    ];
    const rng = deterministicRng([0]);
    const pair = selectNextPair(engineers, new Map(), { swissBandSize: 1 }, rng);
    expect(pair).not.toBeNull();
    expect(pair!.aEmail).toBe("a@x");
    expect(pair!.bEmail).toBe("b@x");
  });
});

describe("selectNextPair — rating-gap ceiling", () => {
  it("filters out pairs above maxRatingGap in Swiss phase", () => {
    const engineers = [
      engineer("top@x", 2000, 10),
      engineer("middle@x", 1700, 10),
      engineer("bottom@x", 1400, 10),
    ];
    // top↔middle gap=300, middle↔bottom gap=300, top↔bottom gap=600.
    // maxRatingGap=400 should permit the first two and exclude top↔bottom.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pair = selectNextPair(
        engineers,
        new Map(),
        { swissBandSize: 2, maxRatingGap: 400 },
      );
      if (pair) seen.add([pair.aEmail, pair.bEmail].sort().join(","));
    }
    expect(seen.has("middle@x,top@x")).toBe(true);
    expect(seen.has("bottom@x,middle@x")).toBe(true);
    expect(seen.has("bottom@x,top@x")).toBe(false);
  });

  it("returns null when all pairs exceed both rating-gap and rematch limits", () => {
    const engineers = [
      engineer("top@x", 2000, 10),
      engineer("bottom@x", 1000, 10),
    ];
    const pair = selectNextPair(
      engineers,
      new Map(),
      { maxRatingGap: 100, swissBandSize: 4 },
    );
    expect(pair).toBeNull();
  });
});

describe("selectNextPair — per-engineer judgment cap", () => {
  it("excludes engineers who hit the per-engineer cap", () => {
    const engineers = [
      engineer("dominant@x", 1900, 50), // already at cap
      engineer("a@x", 1500, 5),
      engineer("b@x", 1500, 5),
    ];
    const observed = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const pair = selectNextPair(engineers, new Map(), {
        maxJudgmentsPerEngineer: 50,
        minMatchesFloor: 5,
      });
      if (pair) {
        observed.add(pair.aEmail);
        observed.add(pair.bEmail);
      }
    }
    expect(observed.has("dominant@x")).toBe(false);
    expect(observed.has("a@x")).toBe(true);
    expect(observed.has("b@x")).toBe(true);
  });

  it("returns null when too few engineers remain under the cap", () => {
    const engineers = [
      engineer("a@x", 1500, 50),
      engineer("b@x", 1500, 50),
      engineer("c@x", 1500, 5),
    ];
    const pair = selectNextPair(engineers, new Map(), {
      maxJudgmentsPerEngineer: 50,
    });
    expect(pair).toBeNull();
  });
});

describe("selectNextPair — rematch cap", () => {
  it("returns null when every remaining pair has hit the rematch cap", () => {
    const engineers = [
      engineer("a@x", 1500, 10),
      engineer("b@x", 1500, 10),
    ];
    const counts = new Map<string, number>([
      [pairKey("a@x", "b@x"), 5],
    ]);
    const pair = selectNextPair(engineers, counts, { maxRematches: 5 });
    expect(pair).toBeNull();
  });

  it("prefers an unsaturated pair over a saturated one", () => {
    const engineers = [
      engineer("a@x", 1500, 10),
      engineer("b@x", 1505, 10),
      engineer("c@x", 1510, 10),
    ];
    const counts = new Map<string, number>([
      [pairKey("a@x", "b@x"), 5], // saturated
    ]);
    const observed = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pair = selectNextPair(engineers, counts, {
        maxRematches: 5,
        swissBandSize: 4,
      });
      if (pair) observed.add(pairKey(pair.aEmail, pair.bEmail));
    }
    // a-b is saturated; algorithm should never pick it.
    expect(observed.has(pairKey("a@x", "b@x"))).toBe(false);
    expect(observed.size).toBeGreaterThan(0);
  });
});
