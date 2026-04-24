import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireDashboardPermission,
  mockGetEngineeringRankingSnapshot,
  mockRankingScaffold,
} = vi.hoisted(() => ({
  mockRequireDashboardPermission: vi.fn(),
  mockGetEngineeringRankingSnapshot: vi.fn(),
  mockRankingScaffold: vi.fn(
    ({ snapshot }: { snapshot: { methodologyVersion: string } }) => (
      <div data-testid="ranking-scaffold">{snapshot.methodologyVersion}</div>
    ),
  ),
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  requireDashboardPermission: mockRequireDashboardPermission,
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingSnapshot: mockGetEngineeringRankingSnapshot,
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
    expect(mockGetEngineeringRankingSnapshot).not.toHaveBeenCalled();
  });

  it("renders the ranking scaffold when the permission check passes", async () => {
    mockRequireDashboardPermission.mockResolvedValue("engineering_manager");
    mockGetEngineeringRankingSnapshot.mockResolvedValue({
      methodologyVersion: "1.0.0-methodology",
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(mockRequireDashboardPermission).toHaveBeenCalledWith(
      "engineering.ranking",
    );
    expect(mockGetEngineeringRankingSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ranking-scaffold")).toHaveTextContent(
      "1.0.0-methodology",
    );
  });
});
