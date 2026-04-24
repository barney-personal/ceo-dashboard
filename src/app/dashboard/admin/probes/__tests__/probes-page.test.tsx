import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRequireDashboardPermission, mockGetProbeStatusSummary, mockGetProbeTimeline } =
  vi.hoisted(() => ({
    mockRequireDashboardPermission: vi.fn(),
    mockGetProbeStatusSummary: vi.fn(),
    mockGetProbeTimeline: vi.fn(),
  }));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  requireDashboardPermission: mockRequireDashboardPermission,
}));

vi.mock("@/lib/data/probes", () => ({
  getProbeStatusSummary: mockGetProbeStatusSummary,
  getProbeTimeline: mockGetProbeTimeline,
}));

import ProbesPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProbesPage permission guard", () => {
  it("requires the admin probes permission before loading data", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockRequireDashboardPermission).toHaveBeenCalledWith("admin.probes");
  });

  it("does not load probe data when permission gating rejects", async () => {
    mockRequireDashboardPermission.mockRejectedValue(new Error("redirected"));

    await expect(ProbesPage()).rejects.toThrow("redirected");
    expect(mockGetProbeStatusSummary).not.toHaveBeenCalled();
    expect(mockGetProbeTimeline).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

describe("ProbesPage data loading", () => {
  it("calls getProbeStatusSummary with known check names", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockGetProbeStatusSummary).toHaveBeenCalledWith(
      ["ceo-ping-auth"],
      expect.any(Date),
    );
  });

  it("calls getProbeTimeline with default 24 hours", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    mockGetProbeStatusSummary.mockResolvedValue([]);
    mockGetProbeTimeline.mockResolvedValue([]);

    await ProbesPage();

    expect(mockGetProbeTimeline).toHaveBeenCalledWith(24);
  });

  it("returns a React element (renders without error)", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
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
