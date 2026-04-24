import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireDashboardPermission,
  mockGetEngineeringRankingPageData,
  mockGetHrAuxiliaryData,
  mockBuildHrEvidencePack,
  mockHrReviewSection,
  mockRankingHeader,
} = vi.hoisted(() => ({
  mockRequireDashboardPermission: vi.fn(),
  mockGetEngineeringRankingPageData: vi.fn(),
  mockGetHrAuxiliaryData: vi.fn(),
  mockBuildHrEvidencePack: vi.fn(),
  mockHrReviewSection: vi.fn(({ pack }: { pack: { bottomN: number } }) => (
    <div data-testid="hr-review-section" data-bottom-n={pack.bottomN} />
  )),
  mockRankingHeader: vi.fn(() => <div data-testid="ranking-header" />),
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  requireDashboardPermission: mockRequireDashboardPermission,
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingPageData: mockGetEngineeringRankingPageData,
  getHrAuxiliaryData: mockGetHrAuxiliaryData,
}));

vi.mock("@/lib/data/engineering-ranking-hr", () => ({
  buildHrEvidencePack: mockBuildHrEvidencePack,
}));

vi.mock("../../_components/hr-review-section", () => ({
  HrReviewSection: mockHrReviewSection,
}));

vi.mock("../../_components/shared", () => ({
  RankingHeader: mockRankingHeader,
}));

import EngineeringRankingHrReviewPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineeringRankingHrReviewPage permission gate", () => {
  it("defers access control to requireDashboardPermission with the HR permission id", async () => {
    mockRequireDashboardPermission.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(EngineeringRankingHrReviewPage()).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mockRequireDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking.hr",
    );
    // The ranking + HR aux fetches must not fire when the caller isn't
    // authorised — otherwise we've leaked work to an unauthenticated request.
    expect(mockGetEngineeringRankingPageData).not.toHaveBeenCalled();
    expect(mockGetHrAuxiliaryData).not.toHaveBeenCalled();
    expect(mockBuildHrEvidencePack).not.toHaveBeenCalled();
  });

  it("fetches ranking + HR auxiliary data and builds the pack when authorised", async () => {
    mockRequireDashboardPermission.mockResolvedValue("ceo");
    const fakeSnapshot = { methodologyVersion: "1.0.0-methodology" };
    mockGetEngineeringRankingPageData.mockResolvedValue({
      snapshot: fakeSnapshot,
      profileSlugByHash: {},
      signals: [],
    });
    const fakeAux = {
      slackRows: [],
      recent30dByLogin: new Map(),
      recent30dAnalyses: [],
      performanceByEmail: new Map(),
    };
    mockGetHrAuxiliaryData.mockResolvedValue(fakeAux);
    mockBuildHrEvidencePack.mockReturnValue({ bottomN: 10, engineers: [] });

    const page = await EngineeringRankingHrReviewPage();
    render(page);

    expect(mockGetEngineeringRankingPageData).toHaveBeenCalledTimes(1);
    expect(mockGetHrAuxiliaryData).toHaveBeenCalledTimes(1);
    expect(mockBuildHrEvidencePack).toHaveBeenCalledWith(fakeSnapshot, {
      signals: [],
      slackRows: fakeAux.slackRows,
      recent30dByLogin: fakeAux.recent30dByLogin,
      recent30dAnalyses: fakeAux.recent30dAnalyses,
      performanceByEmail: fakeAux.performanceByEmail,
    });
    expect(screen.getByTestId("hr-review-section").dataset.bottomN).toBe("10");
  });
});
