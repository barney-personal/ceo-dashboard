import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetCurrentUserRole, mockGetProbeStatusSummary, mockGetProbeTimeline, mockRedirect } =
  vi.hoisted(() => ({
    mockGetCurrentUserRole: vi.fn(),
    mockGetProbeStatusSummary: vi.fn(),
    mockGetProbeTimeline: vi.fn(),
    mockRedirect: vi.fn(),
  }));

vi.mock("@/lib/auth/roles.server", () => ({
  getCurrentUserRole: mockGetCurrentUserRole,
}));

vi.mock("@/lib/data/probes", () => ({
  getProbeStatusSummary: mockGetProbeStatusSummary,
  getProbeTimeline: mockGetProbeTimeline,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import ProbesPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Role gating
// ---------------------------------------------------------------------------

describe("ProbesPage role gating", () => {
  it("redirects non-CEO users to /dashboard", async () => {
    mockGetCurrentUserRole.mockResolvedValue("everyone");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects leadership users to /dashboard", async () => {
    mockGetCurrentUserRole.mockResolvedValue("leadership");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("does not redirect CEO users", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

describe("ProbesPage data loading", () => {
  it("calls getProbeStatusSummary with known check names", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockGetProbeStatusSummary).toHaveBeenCalledWith(
      ["ceo-ping-auth", "ceo-clerk-playwright"],
      expect.any(Date),
    );
  });

  it("calls getProbeTimeline with default 24 hours", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockGetProbeTimeline).toHaveBeenCalledWith(24);
  });

  it("returns a React element (renders without error)", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([
      {
        checkName: "ceo-ping-auth",
        latestStatus: "green",
        latestRunTs: new Date("2026-04-14T10:00:00Z"),
        heartbeatFresh: true,
        heartbeatLastSeen: new Date("2026-04-14T10:00:00Z"),
        heartbeatVersion: "1.0.0",
        openIncident: null,
        uptimePercent7d: 100,
        latencyP50: 120,
        latencyP95: 200,
        recentRedEvents: [],
      },
    ]);
    mockGetProbeTimeline.mockResolvedValue([
      {
        id: 1,
        probeId: "gh-actions",
        checkName: "ceo-ping-auth",
        status: "green",
        latencyMs: 120,
        detailsJson: null,
        runId: null,
        target: "prod",
        ts: new Date("2026-04-14T10:00:00Z"),
      },
    ]);

    const result = await ProbesPage();

    expect(result).toBeDefined();
    expect(result.type).toBe("div");
  });
});
