import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, fromMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
  },
}));

describe("dashboard-permissions.server", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
    fromMock.mockReset();
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
});
