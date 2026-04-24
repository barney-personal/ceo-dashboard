import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, fromMock, getCurrentUserRoleMock, redirectMock } = vi.hoisted(
  () => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
    getCurrentUserRoleMock: vi.fn(),
    redirectMock: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("../roles.server", () => ({
  getCurrentUserRole: getCurrentUserRoleMock,
}));

describe("dashboard-permissions.server", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
    fromMock.mockReset();
    getCurrentUserRoleMock.mockReset();
    redirectMock.mockReset();
    selectMock.mockReturnValue({ from: fromMock });
  });

  it("falls back to code defaults when the permissions table is pre-migration", async () => {
    fromMock.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "dashboard_permission_overrides" does not exist',
    });

    const { getDashboardPermissionSummaries } = await import(
      "../dashboard-permissions.server"
    );

    const summaries = await getDashboardPermissionSummaries();
    const permissions = summaries.find(
      (summary) => summary.id === "admin.permissions",
    );

    expect(permissions?.requiredRole).toBe("ceo");
    expect(permissions?.editable).toBe(false);
  });

  it("does not swallow database availability failures", async () => {
    fromMock.mockRejectedValueOnce({
      code: "CONNECT_TIMEOUT",
      message: "connect timeout",
    });

    const { getDashboardPermissionSummaries } = await import(
      "../dashboard-permissions.server"
    );

    await expect(getDashboardPermissionSummaries()).rejects.toMatchObject({
      code: "CONNECT_TIMEOUT",
    });
  });

  it("ignores invalid stored roles and falls back to defaults", async () => {
    fromMock.mockResolvedValueOnce([
      {
        permissionId: "dashboard.financial",
        requiredRole: "owner",
      },
    ]);

    const { getDashboardPermissionSummaries } = await import(
      "../dashboard-permissions.server"
    );

    const summaries = await getDashboardPermissionSummaries();
    const financial = summaries.find(
      (summary) => summary.id === "dashboard.financial",
    );

    expect(financial?.requiredRole).toBe("leadership");
    expect(financial?.isOverride).toBe(false);
  });

  it("redirects away from routes when the current user lacks access", async () => {
    fromMock.mockResolvedValueOnce([]);
    getCurrentUserRoleMock.mockResolvedValueOnce("everyone");

    const { requireDashboardPermission } = await import(
      "../dashboard-permissions.server"
    );

    await requireDashboardPermission("admin.users");

    expect(selectMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
