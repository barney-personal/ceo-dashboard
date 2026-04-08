import { describe, expect, it } from "vitest";
import {
  evaluateQueueDecision,
  getEffectiveSyncState,
  getSyncSourceConfig,
} from "@/lib/sync/config";

describe("evaluateQueueDecision", () => {
  const modeConfig = getSyncSourceConfig("mode");

  it("queues when there is no prior completed run", () => {
    const decision = evaluateQueueDecision(modeConfig, {
      latestCompletedAt: null,
      latestCompletedStatus: null,
      now: new Date("2026-04-08T12:00:00Z"),
    });

    expect(decision.shouldQueue).toBe(true);
    expect(decision.outcome).toBe("queued");
  });

  it("skips within the normal interval after a successful sync", () => {
    const decision = evaluateQueueDecision(modeConfig, {
      latestCompletedAt: new Date("2026-04-08T10:00:00Z"),
      latestCompletedStatus: "success",
      now: new Date("2026-04-08T12:00:00Z"),
    });

    expect(decision.shouldQueue).toBe(false);
    expect(decision.reason).toBe("within_interval");
    expect(decision.nextEligibleAt?.toISOString()).toBe(
      "2026-04-08T14:00:00.000Z"
    );
  });

  it("retries partial or error runs after 30 minutes", () => {
    const decision = evaluateQueueDecision(modeConfig, {
      latestCompletedAt: new Date("2026-04-08T11:40:00Z"),
      latestCompletedStatus: "error",
      now: new Date("2026-04-08T12:00:00Z"),
    });

    expect(decision.shouldQueue).toBe(false);
    expect(decision.reason).toBe("retry_after_error");
    expect(decision.nextEligibleAt?.toISOString()).toBe(
      "2026-04-08T12:10:00.000Z"
    );
  });

  it("allows force to bypass interval checks", () => {
    const decision = evaluateQueueDecision(modeConfig, {
      latestCompletedAt: new Date("2026-04-08T11:55:00Z"),
      latestCompletedStatus: "success",
      now: new Date("2026-04-08T12:00:00Z"),
      force: true,
    });

    expect(decision.shouldQueue).toBe(true);
    expect(decision.outcome).toBe("forced");
  });
});

describe("getEffectiveSyncState", () => {
  it("marks explicitly abandoned runs as abandoned", () => {
    expect(
      getEffectiveSyncState({
        status: "error",
        leaseExpiresAt: null,
        skipReason: "abandoned",
      })
    ).toBe("abandoned");
  });

  it("marks expired running leases as abandoned", () => {
    expect(
      getEffectiveSyncState(
        {
          status: "running",
          leaseExpiresAt: "2026-04-08T11:59:59Z",
          skipReason: null,
        },
        new Date("2026-04-08T12:00:00Z")
      )
    ).toBe("abandoned");
  });
});
