import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetEngineeringViewResolution, mockRedirect } = vi.hoisted(() => ({
  mockGetEngineeringViewResolution: vi.fn(),
  mockRedirect: vi.fn((_url: string) => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/auth/engineering-view.server", () => ({
  getEngineeringViewResolution: mockGetEngineeringViewResolution,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import EngineeringRoot from "../page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/dashboard/engineering root page dispatch", () => {
  it("redirects to delivery-health when surface is a-side", async () => {
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "a-side",
      actualCeo: false,
      toggleOn: false,
      effectiveRole: "everyone",
    });

    await expect(EngineeringRoot()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/dashboard/engineering/delivery-health",
    );
  });

  it("redirects to delivery-health for CEO with toggle OFF", async () => {
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "a-side",
      actualCeo: true,
      toggleOn: false,
      effectiveRole: "ceo",
    });

    await expect(EngineeringRoot()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/dashboard/engineering/delivery-health",
    );
  });

  it("does NOT redirect when surface is b-side — layout renders EngineeringBRoot in place of children", async () => {
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
      effectiveRole: "ceo",
    });

    const result = await EngineeringRoot();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("does NOT redirect to A-side when surface is b-side even if caller flags are unusual", async () => {
    // Defensive check: surface is the source of truth; if a future bug sets
    // surface=b-side but toggleOn=false, we still must not bounce the CEO
    // back to A-side (that would hide B-side content the resolver said to show).
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: false,
      effectiveRole: "ceo",
    });

    const result = await EngineeringRoot();
    expect(result).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
