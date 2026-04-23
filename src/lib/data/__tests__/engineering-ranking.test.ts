import { describe, expect, it } from "vitest";
import {
  RANKING_METHODOLOGY_VERSION,
  getEngineeringRanking,
} from "../engineering-ranking";

describe("getEngineeringRanking (M2 signal availability)", () => {
  it("returns a methodology_pending snapshot with no engineers ranked", async () => {
    const snapshot = await getEngineeringRanking();
    expect(snapshot.status).toBe("methodology_pending");
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.engineers).toEqual([]);
  });

  it("does not claim the PR review graph is available", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const reviewGraph = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("reviewer graph")
    );
    expect(reviewGraph).toBeDefined();
    expect(reviewGraph?.state).toBe("unavailable");
  });

  it("marks individual review turnaround as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const turnaround = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("review turnaround")
    );
    expect(turnaround).toBeDefined();
    expect(turnaround?.state).toBe("unavailable");
    expect(turnaround?.note).toBeTruthy();
  });

  it("marks individual PR cycle time as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const cycleTime = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("cycle time")
    );
    expect(cycleTime).toBeDefined();
    expect(cycleTime?.state).toBe("unavailable");
    expect(cycleTime?.note).toBeTruthy();
  });

  it("keeps the per-PR LLM rubric marked as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const rubric = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("rubric")
    );
    expect(rubric).toBeDefined();
    expect(rubric?.state).toBe("unavailable");
  });

  it("labels Swarmia DORA as squad context, not an individual signal", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const swarmia = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("swarmia")
    );
    expect(swarmia).toBeDefined();
    expect(swarmia?.name.toLowerCase()).toContain("squad");
    expect(swarmia?.note).toBeTruthy();
  });

  it("surfaces the missing-review-signal limitation on the page", async () => {
    const { knownLimitations } = await getEngineeringRanking();
    const mentionsMissingReview = knownLimitations.some((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes("review turnaround") ||
        lower.includes("review graph") ||
        lower.includes("reviewer graph") ||
        lower.includes("cycle time")
      );
    });
    expect(mentionsMissingReview).toBe(true);
  });

  it("does not attribute manager chain to the squads registry signal", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const squadsRegistry = plannedSignals.filter((s) => {
      const lower = s.name.toLowerCase();
      return lower.includes("squads registry") || lower.includes("squad registry");
    });
    expect(squadsRegistry.length).toBeGreaterThan(0);
    for (const signal of squadsRegistry) {
      const haystack = `${signal.name} ${signal.note ?? ""}`.toLowerCase();
      expect(haystack).not.toMatch(/manager chain/);
      expect(haystack.includes("manager email") || haystack.includes("manager_email")).toBe(false);
    }
  });

  it("sources manager chain from Mode Headcount SSoT, not squads", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const managerChainSource = plannedSignals.find((s) => {
      const haystack = `${s.name} ${s.note ?? ""}`.toLowerCase();
      return haystack.includes("manager chain");
    });
    expect(managerChainSource).toBeDefined();
    expect(managerChainSource?.name.toLowerCase()).toContain("headcount");
  });

  it("never labels any review-related signal as available", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const reviewishAvailable = plannedSignals.filter((s) => {
      const lower = s.name.toLowerCase();
      const mentionsReview =
        lower.includes("review") ||
        (lower.includes("cycle time") && lower.includes("pr"));
      const isIndividualSignal =
        !lower.includes("squad") && !lower.includes("swarmia");
      return mentionsReview && isIndividualSignal && s.state === "available";
    });
    expect(reviewishAvailable).toEqual([]);
  });
});
