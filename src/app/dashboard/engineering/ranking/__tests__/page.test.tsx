import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireDashboardPermission,
  mockGetRequiredRoleForDashboardPermission,
  mockGetEngineeringRankingPageData,
  mockMainScaffold,
} = vi.hoisted(() => ({
  mockRequireDashboardPermission: vi.fn(),
  mockGetRequiredRoleForDashboardPermission: vi.fn(),
  mockGetEngineeringRankingPageData: vi.fn(),
  mockMainScaffold: vi.fn(
    ({
      snapshot,
      canSeeHrReview,
    }: {
      snapshot: { methodologyVersion: string };
      canSeeHrReview?: boolean;
    }) => (
      <div
        data-testid="main-scaffold"
        data-can-see-hr={canSeeHrReview ? "true" : "false"}
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

vi.mock("../_components/main-scaffold", () => ({
  MainScaffold: mockMainScaffold,
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

  it("renders the main scaffold when the permission check passes", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
      signals: [],
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
    expect(screen.getByTestId("main-scaffold")).toHaveTextContent(
      "1.0.0-methodology",
    );
  });

  it("flags canSeeHrReview=false when the viewer is below the HR role threshold", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
      signals: [],
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(screen.getByTestId("main-scaffold").dataset.canSeeHr).toBe("false");
  });

  it("flags canSeeHrReview=true when the viewer has the HR role", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    mockGetRequiredRoleForDashboardPermission.mockResolvedValue("ceo");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
      signals: [],
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(screen.getByTestId("main-scaffold").dataset.canSeeHr).toBe("true");
  });
});
