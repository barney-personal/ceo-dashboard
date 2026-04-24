import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireDashboardPermission,
  mockGetRequiredRoleForDashboardPermission,
  mockGetEngineeringRankingPageData,
  mockBuildHrEvidencePack,
  mockRankingScaffold,
} = vi.hoisted(() => ({
  mockRequireDashboardPermission: vi.fn(),
  mockGetRequiredRoleForDashboardPermission: vi.fn(),
  mockGetEngineeringRankingPageData: vi.fn(),
  mockBuildHrEvidencePack: vi.fn(),
  mockRankingScaffold: vi.fn(
    ({
      snapshot,
      canSeeHrReview,
      hrPack,
    }: {
      snapshot: { methodologyVersion: string };
      canSeeHrReview?: boolean;
      hrPack?: { bottomN: number } | null;
    }) => (
      <div
        data-testid="ranking-scaffold"
        data-can-see-hr={canSeeHrReview ? "true" : "false"}
        data-hr-pack-present={hrPack ? "true" : "false"}
      >
        {snapshot.methodologyVersion}
      </div>
    ),
  ),
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  requireDashboardPermission: mockRequireDashboardPermission,
  getRequiredRoleForDashboardPermission: mockGetRequiredRoleForDashboardPermission,
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingPageData: mockGetEngineeringRankingPageData,
}));

vi.mock("@/lib/data/engineering-ranking-hr", () => ({
  buildHrEvidencePack: mockBuildHrEvidencePack,
}));

vi.mock("../_components/ranking-scaffold", () => ({
  RankingScaffold: mockRankingScaffold,
}));

import EngineeringRankingPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineeringRankingPage permission gate", () => {
  it("defers access control to requireDashboardPermission", async () => {
    mockRequireDashboardPermission.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(EngineeringRankingPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRequireDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking",
    );
    expect(mockGetEngineeringRankingPageData).not.toHaveBeenCalled();
  });

  it("renders the ranking scaffold when the permission check passes", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(mockRequireDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking",
    );
    expect(mockGetRequiredRoleForDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking.hr",
    );
    expect(mockGetEngineeringRankingPageData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ranking-scaffold")).toHaveTextContent(
      "1.0.0-methodology",
    );
  });

  it("does not build the HR pack when the viewer is below the HR role threshold", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
      signals: [],
      slackRows: [],
      recent30dByLogin: new Map(),
      recent30dAnalyses: [],
      performanceByEmail: new Map(),
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(mockBuildHrEvidencePack).not.toHaveBeenCalled();
    const scaffold = screen.getByTestId("ranking-scaffold");
    expect(scaffold.dataset.canSeeHr).toBe("false");
    expect(scaffold.dataset.hrPackPresent).toBe("false");
  });

  it("builds and passes the HR pack when the viewer has the HR role", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    const fakeSnapshot = { methodologyVersion: "1.0.0-methodology" };
    const fakeSlack: never[] = [];
    const fakeActivity = new Map();
    const fakeAnalyses: never[] = [];
    const fakePerf = new Map();
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: fakeSnapshot,
      profileSlugByHash: {},
      signals: [],
      slackRows: fakeSlack,
      recent30dByLogin: fakeActivity,
      recent30dAnalyses: fakeAnalyses,
      performanceByEmail: fakePerf,
    });
    mockBuildHrEvidencePack.mockReturnValue({ bottomN: 10, engineers: [] });

    const page = await EngineeringRankingPage();
    render(page);

    expect(mockBuildHrEvidencePack).toHaveBeenCalledWith(fakeSnapshot, {
      signals: [],
      slackRows: fakeSlack,
      recent30dByLogin: fakeActivity,
      recent30dAnalyses: fakeAnalyses,
      performanceByEmail: fakePerf,
    });
    const scaffold = screen.getByTestId("ranking-scaffold");
    expect(scaffold.dataset.canSeeHr).toBe("true");
    expect(scaffold.dataset.hrPackPresent).toBe("true");
  });
});
