import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/request-auth", () => ({
  authorizeSyncRequest: vi.fn(),
  syncRequestAccessErrorResponse: vi.fn(),
}));

vi.mock("@/lib/sync/code-review", () => ({
  runCodeReviewAnalysis: vi.fn(),
}));

import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { runCodeReviewAnalysis } from "@/lib/sync/code-review";
import { POST } from "@/app/api/sync/code-review/route";

const mockAuthorize = vi.mocked(authorizeSyncRequest);
const mockAuthErr = vi.mocked(syncRequestAccessErrorResponse);
const mockRun = vi.mocked(runCodeReviewAnalysis);

function req(url = "http://localhost/api/sync/code-review"): NextRequest {
  return new NextRequest(url, { method: "POST" });
}

describe("POST /api/sync/code-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the auth-error response when the caller is not allowed", async () => {
    mockAuthorize.mockResolvedValue("forbidden");
    // Real syncRequestAccessErrorResponse would return a NextResponse with 403.
    mockAuthErr.mockReturnValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as unknown as ReturnType<typeof syncRequestAccessErrorResponse>,
    );
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs analysis and echoes the result + trigger for manual calls", async () => {
    mockAuthorize.mockResolvedValue("manual");
    mockAuthErr.mockReturnValue(null);
    mockRun.mockResolvedValue({
      candidatesConsidered: 20,
      cached: 15,
      analysed: 5,
      failed: [],
      skipped: [],
      durationMs: 1234,
    });
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.trigger).toBe("manual");
    expect(body.analysed).toBe(5);
    expect(body.cached).toBe(15);
  });

  it("propagates the force + limit query params", async () => {
    mockAuthorize.mockResolvedValue("manual");
    mockAuthErr.mockReturnValue(null);
    mockRun.mockResolvedValue({
      candidatesConsidered: 0,
      cached: 0,
      analysed: 0,
      failed: [],
      skipped: [],
      durationMs: 1,
    });
    await POST(req("http://localhost/api/sync/code-review?force=1&limit=7"));
    expect(mockRun).toHaveBeenCalledWith({ force: true, limit: 7 });
  });

  it("clamps limit to the safe range", async () => {
    mockAuthorize.mockResolvedValue("manual");
    mockAuthErr.mockReturnValue(null);
    mockRun.mockResolvedValue({
      candidatesConsidered: 0,
      cached: 0,
      analysed: 0,
      failed: [],
      skipped: [],
      durationMs: 1,
    });
    await POST(req("http://localhost/api/sync/code-review?limit=999"));
    expect(mockRun).toHaveBeenCalledWith({ force: false, limit: 500 });
  });

  it("returns 500 with a detail message when the runner throws", async () => {
    mockAuthorize.mockResolvedValue("manual");
    mockAuthErr.mockReturnValue(null);
    mockRun.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toContain("db down");
  });
});
