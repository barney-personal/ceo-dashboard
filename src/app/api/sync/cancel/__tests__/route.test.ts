import { NextResponse } from "next/server";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/sync/request-auth", () => ({
  authErrorResponse: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/sync/coordinator", () => ({
  cancelSyncRun: vi.fn(),
}));

import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { cancelSyncRun } from "@/lib/sync/coordinator";
import { POST } from "../route";

const mockAuthErrorResponse = vi.mocked(authErrorResponse);
const mockRequireRole = vi.mocked(requireRole);
const mockCancelSyncRun = vi.mocked(cancelSyncRun);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/sync/cancel", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/sync/cancel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthErrorResponse.mockImplementation((auth) => {
      if (auth.ok) {
        return null;
      }

      return NextResponse.json({ error: auth.error }, { status: auth.status });
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireRole.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when user lacks CEO role", async () => {
    mockRequireRole.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 400 when syncLogId is missing", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "syncLogId must be a positive integer",
    });
  });

  it("returns 400 when body has no syncLogId key", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({ other: "value" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when syncLogId is not a positive integer", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({ syncLogId: "abc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "syncLogId must be a positive integer",
    });
  });

  it("delegates to cancelSyncRun with the provided syncLogId", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    mockCancelSyncRun.mockResolvedValue({ cancelled: true });
    const res = await POST(makeRequest({ syncLogId: "42" }));
    expect(mockCancelSyncRun).toHaveBeenCalledWith(42);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cancelled: true,
      status: "cancelled",
    });
  });

  it("returns 404 when the sync run does not exist", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    mockCancelSyncRun.mockResolvedValue({ cancelled: false, reason: "not_found" });
    const res = await POST(makeRequest({ syncLogId: 999 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 when the sync run is already in a terminal state", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    mockCancelSyncRun.mockResolvedValue({
      cancelled: false,
      reason: "not_cancellable",
    });
    const res = await POST(makeRequest({ syncLogId: 1 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_cancellable" });
  });

  it("routes cancellation through cancelSyncRun not direct DB update", async () => {
    // This test verifies the route delegates to cancelSyncRun (which uses
    // finalizeSyncRun with status:"cancelled") rather than directly setting
    // status:"error" as the original implementation did.
    mockRequireRole.mockResolvedValue({ ok: true });
    mockCancelSyncRun.mockResolvedValue({ cancelled: true });
    await POST(makeRequest({ syncLogId: 7 }));
    expect(mockCancelSyncRun).toHaveBeenCalledTimes(1);
    expect(mockCancelSyncRun).toHaveBeenCalledWith(7);
  });
});
