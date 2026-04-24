import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboardPermissionSummaries } from "@/lib/auth/dashboard-permissions";

const {
  mockRequireRole,
  mockAuthErrorResponse,
  mockGetDashboardPermissionSummaries,
  mockRevalidatePath,
  mockEq,
  mockDeleteWhere,
  mockDelete,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockAuthErrorResponse: vi.fn(),
  mockGetDashboardPermissionSummaries: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockEq: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDelete: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockValues: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: mockEq,
  };
});

vi.mock("@/lib/sync/request-auth", () => ({
  requireRole: mockRequireRole,
  authErrorResponse: mockAuthErrorResponse,
}));

vi.mock("@/lib/auth/dashboard-permissions.server", () => ({
  getDashboardPermissionSummaries: mockGetDashboardPermissionSummaries,
}));

vi.mock("@/lib/db", () => ({
  db: {
    delete: mockDelete,
    insert: mockInsert,
  },
}));

import { DELETE, PATCH } from "../route";

function request(method: "PATCH" | "DELETE", body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/permissions`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({ ok: true });
    mockAuthErrorResponse.mockReturnValue(null);
    mockEq.mockReturnValue("eq-clause");
    mockDeleteWhere.mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: mockDeleteWhere });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockInsert.mockReturnValue({ values: mockValues });
    mockGetDashboardPermissionSummaries.mockResolvedValue(
      buildDashboardPermissionSummaries(),
    );
  });

  it("returns 400 when required PATCH fields are missing", async () => {
    const response = await PATCH(request("PATCH", {}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "permissionId and requiredRole are required",
    });
  });

  it("returns 400 for malformed PATCH json", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON body",
    });
  });

  it("returns 404 for unknown permission ids", async () => {
    const response = await PATCH(
      request("PATCH", {
        permissionId: "admin.unknown",
        requiredRole: "ceo",
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Unknown dashboard permission",
    });
  });

  it("returns 400 for invalid roles", async () => {
    const response = await PATCH(
      request("PATCH", {
        permissionId: "dashboard.financial",
        requiredRole: "owner",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid role. Must be one of: everyone, manager, leadership, ceo",
    });
  });

  it("returns 400 for locked permissions", async () => {
    const response = await PATCH(
      request("PATCH", {
        permissionId: "admin.users",
        requiredRole: "leadership",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This permission is locked and cannot be changed",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("writes overrides and revalidates on successful PATCH", async () => {
    mockGetDashboardPermissionSummaries.mockResolvedValue(
      buildDashboardPermissionSummaries({
        "dashboard.financial": "manager",
      }),
    );

    const response = await PATCH(
      request("PATCH", {
        permissionId: "dashboard.financial",
        requiredRole: "manager",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionId: "dashboard.financial",
        requiredRole: "manager",
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(1, "/dashboard", "layout");
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(
      2,
      "/dashboard/admin/permissions",
    );
    expect(await response.json()).toMatchObject({
      id: "dashboard.financial",
      requiredRole: "manager",
      isOverride: true,
    });
  });

  it("returns 400 when resetting a locked permission", async () => {
    const response = await DELETE(
      request("DELETE", {
        permissionId: "admin.status",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This permission is locked and cannot be reset",
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed DELETE json", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/admin/permissions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON body",
    });
  });
});
