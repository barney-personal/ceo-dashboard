import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentUserRole,
  mockGetDashboardPermissionRoleMap,
  mockGetEngineeringViewResolution,
  mockEngineeringTabs,
  mockEngineeringViewToggle,
} = vi.hoisted(() => ({
  mockGetCurrentUserRole: vi.fn(),
  mockGetDashboardPermissionRoleMap: vi.fn(),
  mockGetEngineeringViewResolution: vi.fn(),
  mockEngineeringTabs: vi.fn(() => (
    <div data-testid="engineering-tabs">A-side tabs</div>
  )),
  mockEngineeringViewToggle: vi.fn(({ initialToggleOn }: { initialToggleOn: boolean }) => (
    <div
      data-testid="engineering-view-toggle"
      data-toggle-on={initialToggleOn ? "true" : "false"}
    />
  )),
}));

vi.mock("@/lib/auth/roles.server", () => ({
  getCurrentUserRole: mockGetCurrentUserRole,
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  getDashboardPermissionRoleMap: mockGetDashboardPermissionRoleMap,
}));

vi.mock("@/lib/auth/engineering-view.server", () => ({
  getEngineeringViewResolution: mockGetEngineeringViewResolution,
}));

vi.mock("@/components/dashboard/engineering-tabs", () => ({
  EngineeringTabs: mockEngineeringTabs,
}));

vi.mock("@/components/dashboard/engineering-view-toggle", () => ({
  EngineeringViewToggle: mockEngineeringViewToggle,
}));

import EngineeringLayout from "../layout";

const PERMISSION_ROLES = {
  "engineering.impact": "leadership",
  "engineering.impactModel": "manager",
  "engineering.codeReview": "engineering_manager",
  "engineering.ranking": "engineering_manager",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDashboardPermissionRoleMap.mockResolvedValue(PERMISSION_ROLES);
});

async function renderLayout(children: React.ReactNode) {
  const element = await EngineeringLayout({ children });
  render(element);
}

describe("EngineeringLayout dispatch", () => {
  it("renders A-side children when surface is a-side (anon)", async () => {
    mockGetCurrentUserRole.mockResolvedValue("everyone");
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "a-side",
      actualCeo: false,
      toggleOn: false,
      effectiveRole: "everyone",
    });

    await renderLayout(<div data-testid="a-side-children">A-side content</div>);

    expect(screen.getByTestId("a-side-children")).toBeInTheDocument();
    expect(screen.queryByTestId("engineering-b-root")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-tabs")).toBeInTheDocument();
    expect(
      screen.queryByTestId("engineering-view-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Open in Swarmia/)).toBeInTheDocument();
  });

  it("shows the toggle but stays on A-side for CEO with toggle OFF", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "a-side",
      actualCeo: true,
      toggleOn: false,
      effectiveRole: "ceo",
    });

    await renderLayout(<div data-testid="a-side-children">A-side content</div>);

    expect(screen.getByTestId("a-side-children")).toBeInTheDocument();
    expect(screen.queryByTestId("engineering-b-root")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-tabs")).toBeInTheDocument();
    const toggle = screen.getByTestId("engineering-view-toggle");
    expect(toggle.getAttribute("data-toggle-on")).toBe("false");
  });

  it("renders EngineeringBRoot and hides A-side tabs/Swarmia link when surface is b-side", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
      effectiveRole: "ceo",
    });

    await renderLayout(
      <div data-testid="a-side-children">A-side content MUST NOT render</div>,
    );

    // A-side children are replaced by B-side root
    expect(screen.queryByTestId("a-side-children")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-b-root")).toBeInTheDocument();
    expect(
      screen.queryByTestId("engineering-tabs"),
    ).not.toBeInTheDocument();
    // Swarmia link is an A-side affordance and should disappear on B-side
    expect(screen.queryByText(/Open in Swarmia/)).not.toBeInTheDocument();
    // Toggle remains so the CEO can switch back
    const toggle = screen.getByTestId("engineering-view-toggle");
    expect(toggle.getAttribute("data-toggle-on")).toBe("true");
  });

  it("forwards the effective role to EngineeringBRoot for persona rendering", async () => {
    mockGetCurrentUserRole.mockResolvedValue("ceo");
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
      effectiveRole: "ceo",
    });

    await renderLayout(<div data-testid="ignored" />);

    const bRoot = screen.getByTestId("engineering-b-root");
    expect(bRoot.getAttribute("data-persona")).toBe("manager");
  });

  it("keeps non-CEO users on A-side even if the resolver says a-side (forged metadata scenario)", async () => {
    // Simulate a non-CEO with forged publicMetadata.engineeringViewB — the
    // resolver (tested separately) forces surface=a-side. The layout must
    // honor that surface and render A-side children untouched.
    mockGetCurrentUserRole.mockResolvedValue("leadership");
    mockGetEngineeringViewResolution.mockResolvedValue({
      surface: "a-side",
      actualCeo: false,
      toggleOn: false,
      effectiveRole: "leadership",
    });

    await renderLayout(
      <div data-testid="a-side-children">A-side leadership content</div>,
    );

    expect(screen.getByTestId("a-side-children")).toBeInTheDocument();
    expect(screen.queryByTestId("engineering-b-root")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("engineering-view-toggle"),
    ).not.toBeInTheDocument();
  });
});
