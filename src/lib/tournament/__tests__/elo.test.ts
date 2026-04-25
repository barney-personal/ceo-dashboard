import { describe, expect, it } from "vitest";
import { applyEloUpdate, expectedScore } from "../elo";

describe("expectedScore", () => {
  it("equal ratings → 0.5", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5);
  });

  it("400 elo gap → favourite wins ~91% of the time", () => {
    expect(expectedScore(1900, 1500)).toBeGreaterThan(0.9);
    expect(expectedScore(1900, 1500)).toBeLessThan(0.92);
  });

  it("symmetric across both engineers", () => {
    const a = expectedScore(1620, 1480);
    const b = expectedScore(1480, 1620);
    expect(a + b).toBeCloseTo(1, 5);
  });
});

describe("applyEloUpdate", () => {
  it("verdict A: A gains, B loses; deltas symmetric", () => {
    const update = applyEloUpdate(1500, 1500, "A", 16);
    expect(update.deltaA).toBeCloseTo(8, 3);
    expect(update.ratingA).toBeCloseTo(1508, 3);
    expect(update.ratingB).toBeCloseTo(1492, 3);
  });

  it("verdict B: B gains, A loses", () => {
    const update = applyEloUpdate(1500, 1500, "B", 16);
    expect(update.deltaA).toBeCloseTo(-8, 3);
    expect(update.ratingA).toBeCloseTo(1492, 3);
    expect(update.ratingB).toBeCloseTo(1508, 3);
  });

  it("draw between equals: zero delta", () => {
    const update = applyEloUpdate(1500, 1500, "draw", 16);
    expect(update.deltaA).toBeCloseTo(0, 3);
    expect(update.ratingA).toBeCloseTo(1500, 3);
    expect(update.ratingB).toBeCloseTo(1500, 3);
  });

  it("upset: low-rated A beats high-rated B → big delta for A", () => {
    const update = applyEloUpdate(1300, 1700, "A", 16);
    expect(update.deltaA).toBeGreaterThan(13);
    expect(update.deltaA).toBeLessThan(16);
  });

  it("expected upset: high-rated A beats low-rated B → small delta", () => {
    const update = applyEloUpdate(1700, 1300, "A", 16);
    expect(update.deltaA).toBeGreaterThan(0);
    expect(update.deltaA).toBeLessThan(3);
  });

  it("K=16 keeps total drift bounded across many matches", () => {
    let r1 = 1500;
    let r2 = 1500;
    for (let i = 0; i < 100; i++) {
      const update = applyEloUpdate(r1, r2, i % 2 === 0 ? "A" : "B", 16);
      r1 = update.ratingA;
      r2 = update.ratingB;
    }
    expect(r1 + r2).toBeCloseTo(3000, 1);
  });
});
