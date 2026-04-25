import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireDashboardPermission,
  mockGetEngineeringRankingPageData,
  mockMethodologyScaffold,
} = vi.hoisted(() => ({
  mockRequireDashboardPermission: vi.fn(),
  mockGetEngineeringRankingPageData: vi.fn(),
  mockMethodologyScaffold: vi.fn(
    ({ snapshot }: { snapshot: { methodologyVersion: string } }) => (
      <div data-testid="methodology-scaffold">
        {snapshot.methodologyVersion}
      </div>
    ),
  ),
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  requireDashboardPermission: mockRequireDashboardPermission,
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingPageData: mockGetEngineeringRankingPageData,
}));

vi.mock("../../_components/methodology-scaffold", () => ({
  MethodologyScaffold: mockMethodologyScaffold,
}));

import EngineeringRankingMethodologyPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineeringRankingMethodologyPage permission gate", () => {
  it("defers access control to requireDashboardPermission with the base ranking permission", async () => {
    mockRequireDashboardPermission.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(EngineeringRankingMethodologyPage()).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    // Methodology must reuse the base ranking permission, NOT the HR-gated
    // one — promoting this gate by copy-paste would be a silent security
    // regression, so it's worth asserting explicitly.
    expect(mockRequireDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking",
    );
    expect(mockGetEngineeringRankingPageData).not.toHaveBeenCalled();
  });

  it("renders the methodology scaffold when the permission check passes", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: { methodologyVersion: "1.0.0-methodology" },
      profileSlugByHash: {},
      signals: [],
    });

    const page = await EngineeringRankingMethodologyPage();
    render(page);

    expect(mockGetEngineeringRankingPageData).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("methodology-scaffold")).toHaveTextContent(
      "1.0.0-methodology",
    );
  });
});
