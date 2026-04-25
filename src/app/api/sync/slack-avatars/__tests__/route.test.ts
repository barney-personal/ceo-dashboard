import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/dashboard-permissions.api", () => ({
  dashboardPermissionErrorResponse: vi.fn(),
}));

vi.mock("@/lib/sync/slack-avatars", () => ({
  syncSlackAvatars: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { syncSlackAvatars } from "@/lib/sync/slack-avatars";
import { POST } from "../route";

const mockPermissionGate = vi.mocked(dashboardPermissionErrorResponse);
const mockSync = vi.mocked(syncSlackAvatars);

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "POST" });
}

describe("POST /api/sync/slack-avatars", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPermissionGate.mockResolvedValue(null);
  });

  it("returns 401/403 when permission gate denies", async () => {
    mockPermissionGate.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const res = await POST(
      makeRequest("http://localhost/api/sync/slack-avatars")
    );
    expect(res.status).toBe(401);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("invokes sync without force when query param is absent", async () => {
    mockSync.mockResolvedValue({
      total: 5,
      fetched: 3,
      unchanged: 1,
      failed: 1,
    });
    const res = await POST(
      makeRequest("http://localhost/api/sync/slack-avatars")
    );
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith({ force: false });
    await expect(res.json()).resolves.toEqual({
      total: 5,
      fetched: 3,
      unchanged: 1,
      failed: 1,
    });
  });

  it("invokes sync with force=true when ?force=1", async () => {
    mockSync.mockResolvedValue({
      total: 0,
      fetched: 0,
      unchanged: 0,
      failed: 0,
    });
    await POST(makeRequest("http://localhost/api/sync/slack-avatars?force=1"));
    expect(mockSync).toHaveBeenCalledWith({ force: true });
  });

  it("returns 500 when sync throws", async () => {
    mockSync.mockRejectedValue(new Error("slack down"));
    const res = await POST(
      makeRequest("http://localhost/api/sync/slack-avatars")
    );
    expect(res.status).toBe(500);
  });
});
