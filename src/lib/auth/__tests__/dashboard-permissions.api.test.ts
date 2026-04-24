import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserRoleMock, getRequiredRoleMock } = vi.hoisted(() => ({
  getCurrentUserRoleMock: vi.fn(),
  getRequiredRoleMock: vi.fn(),
}));

vi.mock("../roles.server", () => ({
  getCurrentUserRole: getCurrentUserRoleMock,
}));

vi.mock("../dashboard-permissions.server", () => ({
  getRequiredRoleForDashboardPermission: getRequiredRoleMock,
}));

describe("dashboard-permissions.api", () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentUserRoleMock.mockReset();
    getRequiredRoleMock.mockReset();
  });

  it("returns null when the current user has access", async () => {
    getCurrentUserRoleMock.mockResolvedValueOnce("leadership");
    getRequiredRoleMock.mockResolvedValueOnce("manager");

    const { dashboardPermissionErrorResponse } = await import(
      "../dashboard-permissions.api"
    );

    await expect(
      dashboardPermissionErrorResponse("dashboard.managers"),
    ).resolves.toBeNull();
    expect(getRequiredRoleMock).toHaveBeenCalledWith("dashboard.managers");
  });

  it("returns a 403 response when the current user lacks access", async () => {
    getCurrentUserRoleMock.mockResolvedValueOnce("manager");

    const { dashboardPermissionErrorResponse } = await import(
      "../dashboard-permissions.api"
    );

    const response = await dashboardPermissionErrorResponse("admin.users");

    expect(response?.status).toBe(403);
    expect(getRequiredRoleMock).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
