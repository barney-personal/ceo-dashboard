import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentUserRole,
  mockGetEngineeringRankingSnapshot,
  mockRankingScaffold,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetCurrentUserRole: vi.fn(),
  mockGetEngineeringRankingSnapshot: vi.fn(),
  mockRankingScaffold: vi.fn(
    ({ snapshot }: { snapshot: { methodologyVersion: string } }) => (
      <div data-testid="ranking-scaffold">{snapshot.methodologyVersion}</div>
    ),
  ),
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/auth/roles.server", () => ({
  getCurrentUserRole: mockGetCurrentUserRole,
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingSnapshot: mockGetEngineeringRankingSnapshot,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("../_components/ranking-scaffold", () => ({
  RankingScaffold: mockRankingScaffold,
}));

import EngineeringRankingPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EngineeringRankingPage CEO gate", () => {
  it("redirects non-CEO users back to engineering", async () => {
    mockGetCurrentUserRole.mockResolvedValue("leadership");

    await expect(EngineeringRankingPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/dashboard/engineering");
    expect(mockGetEngineeringRankingSnapshot).not.toHaveBeenCalled();
  });

  it("renders the ranking scaffold for CEO users", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetEngineeringRankingSnapshot.mockResolvedValue({
      methodologyVersion: "1.0.0-methodology",
    });

    const page = await EngineeringRankingPage();
    render(page);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetEngineeringRankingSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ranking-scaffold")).toHaveTextContent(
      "1.0.0-methodology",
    );
  });
});
