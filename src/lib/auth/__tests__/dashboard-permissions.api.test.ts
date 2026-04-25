import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUserRoleMock,
  getRequiredRoleMock,
  getCurrentUserWithTimeoutMock,
} = vi.hoisted(() => ({
  getCurrentUserRoleMock: vi.fn(),
  getRequiredRoleMock: vi.fn(),
  getCurrentUserWithTimeoutMock: vi.fn(),
}));

vi.mock("../roles.server", () => ({
  getCurrentUserRole: getCurrentUserRoleMock,
}));

vi.mock("../dashboard-permissions.server", () => ({
  getRequiredRoleForDashboardPermission: getRequiredRoleMock,
}));

vi.mock("../current-user.server", () => ({
  getCurrentUserWithTimeout: getCurrentUserWithTimeoutMock,
}));

describe("dashboard-permissions.api", () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentUserRoleMock.mockReset();
    getRequiredRoleMock.mockReset();
    getCurrentUserWithTimeoutMock.mockReset();
    // Default: authenticated. Individual tests opt out for the unauth case.
    getCurrentUserWithTimeoutMock.mockResolvedValue({
      status: "authenticated",
      user: { publicMetadata: {}, emailAddresses: [] },
    });
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

  it("returns 401 for unauthenticated callers even when permission is set to everyone", async () => {
    getCurrentUserWithTimeoutMock.mockResolvedValueOnce({
      status: "unauthenticated",
    });
    // If this fired, an anonymous caller would slip through any editable
    // permission lowered to "everyone". Asserting it's never called locks
    // the precheck in.
    getRequiredRoleMock.mockResolvedValue("everyone");
    getCurrentUserRoleMock.mockResolvedValue("everyone");

    const { dashboardPermissionErrorResponse } = await import(
      "../dashboard-permissions.api"
    );

    const response = await dashboardPermissionErrorResponse("admin.squads");
    expect(response?.status).toBe(401);
    expect(getCurrentUserRoleMock).not.toHaveBeenCalled();
    expect(getRequiredRoleMock).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the auth call times out", async () => {
    getCurrentUserWithTimeoutMock.mockResolvedValueOnce({ status: "timeout" });

    const { dashboardPermissionErrorResponse } = await import(
      "../dashboard-permissions.api"
    );

    const response = await dashboardPermissionErrorResponse("admin.squads");
    expect(response?.status).toBe(401);
  });
});
