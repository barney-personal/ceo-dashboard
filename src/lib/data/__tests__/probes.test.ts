import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories run before imports, so variables must
// be created via vi.hoisted() to be available inside the factory.
// ---------------------------------------------------------------------------

const {
  mockAllHeartbeats,
  mockLastRunsForCheck,
  mockOpenIncidentForCheck,
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockFrom,
  mockSelect,
} = vi.hoisted(() => {
  const mockAllHeartbeats = vi.fn();
  const mockLastRunsForCheck = vi.fn();
  const mockOpenIncidentForCheck = vi.fn();

  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockAllHeartbeats,
    mockLastRunsForCheck,
    mockOpenIncidentForCheck,
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockFrom,
    mockSelect,
  };
});

vi.mock("@/lib/probes/repo", () => ({
  allHeartbeats: (...a: unknown[]) => mockAllHeartbeats(...a),
  lastRunsForCheck: (...a: unknown[]) => mockLastRunsForCheck(...a),
  openIncidentForCheck: (...a: unknown[]) => mockOpenIncidentForCheck(...a),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/db/schema", () => ({
  probeRuns: {
    ts: "ts",
    checkName: "check_name",
  },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((col) => col),
  gte: vi.fn((col, val) => ({ col, val, op: "gte" })),
  sql: vi.fn(),
}));

import {
  getProbeStatusSummary,
  getProbeTimeline,
  STALE_HEARTBEAT_MINUTES,
} from "../probes";

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers — build realistic row shapes
// ---------------------------------------------------------------------------

function makeRun(
  overrides: Partial<{
    id: number;
    checkName: string;
    status: string;
    latencyMs: number;
    ts: Date;
    detailsJson: unknown;
    probeId: string;
    runId: string;
    target: string;
  }> = {},
) {
  return {
    id: 1,
    probeId: "gh-actions",
    checkName: "ceo-ping-auth",
    status: "green",
    latencyMs: 120,
    detailsJson: null,
    runId: null,
    target: "prod",
    ts: new Date("2026-04-14T10:00:00Z"),
    ...overrides,
  };
}

function makeHeartbeat(
  overrides: Partial<{
    probeId: string;
    lastSeenAt: Date;
    version: string | null;
  }> = {},
) {
  return {
    probeId: "gh-actions",
    lastSeenAt: new Date("2026-04-14T10:00:00Z"),
    version: "1.0.0",
    ...overrides,
  };
}

function makeIncident(
  overrides: Partial<{
    id: number;
    checkName: string;
    openedAt: Date;
    closedAt: Date | null;
    escalationLevel: number;
    lastAlertedAt: Date | null;
    ackedAt: Date | null;
  }> = {},
) {
  return {
    id: 1,
    checkName: "ceo-ping-auth",
    openedAt: new Date("2026-04-14T09:00:00Z"),
    closedAt: null,
    escalationLevel: 0,
    lastAlertedAt: null,
    ackedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getProbeStatusSummary
// ---------------------------------------------------------------------------

describe("getProbeStatusSummary", () => {
  it("returns summary for each known check with latest run + heartbeat", async () => {
    const now = new Date("2026-04-14T10:05:00Z");

    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ probeId: "gh-actions", lastSeenAt: new Date("2026-04-14T10:00:00Z") }),
    ]);

    const greenRuns = Array.from({ length: 50 }, (_, i) =>
      makeRun({
        id: i + 1,
        checkName: "ceo-ping-auth",
        status: "green",
        latencyMs: 100 + i,
        ts: new Date(Date.now() - i * 3600_000),
      }),
    );
    mockLastRunsForCheck.mockResolvedValue(greenRuns);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(
      ["ceo-ping-auth"],
      now,
    );

    expect(result).toHaveLength(1);
    const summary = result[0];
    expect(summary.checkName).toBe("ceo-ping-auth");
    expect(summary.latestStatus).toBe("green");
    expect(summary.openIncident).toBeNull();
    expect(summary.heartbeatFresh).toBe(true);
    expect(summary.uptimePercent7d).toBe(100);
    expect(typeof summary.latencyP50).toBe("number");
    expect(typeof summary.latencyP95).toBe("number");
    expect(summary.recentRedEvents).toEqual([]);
  });

  it("marks heartbeat as stale when older than threshold", async () => {
    const now = new Date("2026-04-14T10:30:00Z");
    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({
        probeId: "gh-actions",
        lastSeenAt: new Date("2026-04-14T10:10:00Z"),
      }),
    ]);

    mockLastRunsForCheck.mockResolvedValue([
      makeRun({ checkName: "ceo-ping-auth" }),
    ]);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(
      ["ceo-ping-auth"],
      now,
    );

    expect(result[0].heartbeatFresh).toBe(false);
    expect(result[0].heartbeatLastSeen).toEqual(
      new Date("2026-04-14T10:10:00Z"),
    );
  });

  it("includes open incident details when present", async () => {
    const now = new Date("2026-04-14T10:05:00Z");
    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ lastSeenAt: new Date("2026-04-14T10:00:00Z") }),
    ]);
    mockLastRunsForCheck.mockResolvedValue([
      makeRun({ status: "red", checkName: "ceo-ping-auth" }),
    ]);
    mockOpenIncidentForCheck.mockResolvedValue(
      makeIncident({ id: 42, escalationLevel: 2 }),
    );

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    expect(result[0].openIncident).toEqual(
      expect.objectContaining({ id: 42, escalationLevel: 2 }),
    );
  });

  it("calculates correct uptime percentage with mixed statuses", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ lastSeenAt: now }),
    ]);

    const runs = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeRun({ id: i + 1, status: "green", latencyMs: 100 }),
      ),
      makeRun({ id: 9, status: "red", latencyMs: 200 }),
      makeRun({ id: 10, status: "red", latencyMs: 300 }),
    ];
    mockLastRunsForCheck.mockResolvedValue(runs);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    expect(result[0].uptimePercent7d).toBe(80);
  });

  it("computes p50 and p95 latency from run history", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    mockAllHeartbeats.mockResolvedValue([makeHeartbeat({ lastSeenAt: now })]);

    const runs = Array.from({ length: 20 }, (_, i) =>
      makeRun({ id: i + 1, latencyMs: (i + 1) * 10, status: "green" }),
    );
    mockLastRunsForCheck.mockResolvedValue(runs);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    // p50 of [10..200] = 105ms (median of 20 values)
    expect(result[0].latencyP50).toBe(105);
    // p95 of [10..200] with linear interpolation = 190.5ms
    expect(result[0].latencyP95).toBe(190.5);
  });

  it("collects recent red events with details snippets", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    mockAllHeartbeats.mockResolvedValue([makeHeartbeat({ lastSeenAt: now })]);

    const runs = [
      makeRun({ id: 1, status: "green", latencyMs: 100, ts: new Date("2026-04-14T09:45:00Z") }),
      makeRun({
        id: 2,
        status: "red",
        latencyMs: 500,
        ts: new Date("2026-04-14T09:30:00Z"),
        detailsJson: { error: "db_ok: false" },
      }),
      makeRun({
        id: 3,
        status: "red",
        latencyMs: 600,
        ts: new Date("2026-04-14T09:15:00Z"),
        detailsJson: { error: "timeout" },
      }),
    ];
    mockLastRunsForCheck.mockResolvedValue(runs);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    expect(result[0].recentRedEvents).toHaveLength(2);
    expect(result[0].recentRedEvents[0].ts).toEqual(new Date("2026-04-14T09:30:00Z"));
    expect(result[0].recentRedEvents[0].details).toEqual({ error: "db_ok: false" });
  });

  it("handles a check with no history (no runs, no heartbeat)", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    mockAllHeartbeats.mockResolvedValue([]);
    mockLastRunsForCheck.mockResolvedValue([]);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    expect(result[0].checkName).toBe("ceo-ping-auth");
    expect(result[0].latestStatus).toBeNull();
    expect(result[0].heartbeatFresh).toBe(false);
    expect(result[0].heartbeatLastSeen).toBeNull();
    expect(result[0].uptimePercent7d).toBeNull();
    expect(result[0].latencyP50).toBeNull();
    expect(result[0].latencyP95).toBeNull();
    expect(result[0].recentRedEvents).toEqual([]);
    expect(result[0].openIncident).toBeNull();
  });

  it("resolves heartbeat per-check via probeId from latest run", async () => {
    const now = new Date("2026-04-14T10:05:00Z");

    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ probeId: "runner-a", lastSeenAt: new Date("2026-04-14T10:03:00Z") }),
      makeHeartbeat({ probeId: "runner-b", lastSeenAt: new Date("2026-04-14T09:30:00Z") }),
    ]);

    // check-a runs come from runner-a (fresh heartbeat)
    mockLastRunsForCheck.mockResolvedValueOnce([
      makeRun({ checkName: "check-a", probeId: "runner-a", status: "green" }),
    ]);
    // check-b runs come from runner-b (stale heartbeat — 35 min old)
    mockLastRunsForCheck.mockResolvedValueOnce([
      makeRun({ checkName: "check-b", probeId: "runner-b", status: "green" }),
    ]);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["check-a", "check-b"], now);

    expect(result[0].heartbeatFresh).toBe(true);
    expect(result[0].heartbeatLastSeen).toEqual(new Date("2026-04-14T10:03:00Z"));
    expect(result[0].heartbeatVersion).toBe("1.0.0");

    // runner-b last seen 35 min ago → stale
    expect(result[1].heartbeatFresh).toBe(false);
    expect(result[1].heartbeatLastSeen).toEqual(new Date("2026-04-14T09:30:00Z"));
  });

  it("computes uptimePercent7d from only runs within the last 7 days", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ lastSeenAt: now }),
    ]);

    // 10 green runs within last 7 days
    const recentGreen = Array.from({ length: 10 }, (_, i) =>
      makeRun({
        id: i + 1,
        status: "green",
        latencyMs: 100,
        ts: new Date(now.getTime() - i * 3600_000),
      }),
    );
    // 5 red runs older than 7 days (should NOT count)
    const oldRed = Array.from({ length: 5 }, (_, i) =>
      makeRun({
        id: 100 + i,
        status: "red",
        latencyMs: 500,
        ts: new Date(sevenDaysAgo.getTime() - (i + 1) * 3600_000),
      }),
    );

    mockLastRunsForCheck.mockResolvedValue([...recentGreen, ...oldRed]);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const result = await getProbeStatusSummary(["ceo-ping-auth"], now);

    // Only the 10 recent green runs count → 100% uptime
    expect(result[0].uptimePercent7d).toBe(100);
  });

  it("handles multiple checks in a single call", async () => {
    const now = new Date("2026-04-14T10:00:00Z");
    mockAllHeartbeats.mockResolvedValue([
      makeHeartbeat({ probeId: "gh-actions", lastSeenAt: now }),
    ]);

    mockLastRunsForCheck
      .mockResolvedValueOnce([makeRun({ checkName: "ceo-ping-auth", status: "green" })])
      .mockResolvedValueOnce([makeRun({ checkName: "mock-check-b", status: "red" })]);
    mockOpenIncidentForCheck
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeIncident({ checkName: "mock-check-b" }));

    const result = await getProbeStatusSummary(
      ["ceo-ping-auth", "mock-check-b"],
      now,
    );

    expect(result).toHaveLength(2);
    expect(result[0].checkName).toBe("ceo-ping-auth");
    expect(result[0].latestStatus).toBe("green");
    expect(result[1].checkName).toBe("mock-check-b");
    expect(result[1].latestStatus).toBe("red");
    expect(result[1].openIncident).not.toBeNull();
  });

  it("exports STALE_HEARTBEAT_MINUTES as 15", () => {
    expect(STALE_HEARTBEAT_MINUTES).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// getProbeTimeline
// ---------------------------------------------------------------------------

describe("getProbeTimeline", () => {
  it("queries recent probe runs within the specified hours window", async () => {
    const runs = [
      makeRun({ id: 1, ts: new Date("2026-04-14T09:00:00Z") }),
      makeRun({ id: 2, ts: new Date("2026-04-14T08:00:00Z") }),
    ];
    mockLimit.mockResolvedValue(runs);

    const result = await getProbeTimeline(24);

    expect(result).toEqual(runs);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(500);
  });

  it("defaults to 24 hours when no argument provided", async () => {
    mockLimit.mockResolvedValue([]);

    await getProbeTimeline();

    expect(mockWhere).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(500);
  });
});
