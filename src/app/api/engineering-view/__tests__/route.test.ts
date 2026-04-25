import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/engineering-view.server", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/engineering-view.server")
  >("@/lib/auth/engineering-view.server");
  return {
    ...actual,
    getEngineeringViewResolution: vi.fn(),
    setEngineeringViewB: vi.fn(),
  };
});

import {
  EngineeringViewMutationError,
  getEngineeringViewResolution,
  setEngineeringViewB,
} from "@/lib/auth/engineering-view.server";
import { GET, POST } from "../route";

const mockGet = vi.mocked(getEngineeringViewResolution);
const mockSet = vi.mocked(setEngineeringViewB);

function makePost(body: unknown) {
  return new NextRequest("http://localhost/api/engineering-view", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/engineering-view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the surface, actualCeo, and toggleOn from resolution", async () => {
    mockGet.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
      effectiveRole: "ceo",
      impersonatedEmail: null,
      viewerEmail: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
    });
  });

  it("returns a-side defaults for anonymous callers", async () => {
    mockGet.mockResolvedValue({
      surface: "a-side",
      actualCeo: false,
      toggleOn: false,
      effectiveRole: "everyone",
      impersonatedEmail: null,
      viewerEmail: null,
    });
    const res = await GET();
    const body = await res.json();
    expect(body.surface).toBe("a-side");
    expect(body.actualCeo).toBe(false);
  });
});

describe("POST /api/engineering-view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects non-boolean engineeringViewB with 400", async () => {
    const res = await POST(makePost({ engineeringViewB: "yes" }));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("rejects missing engineeringViewB with 400", async () => {
    const res = await POST(makePost({}));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("propagates 401 from setEngineeringViewB for unauthenticated callers", async () => {
    mockSet.mockRejectedValue(
      new EngineeringViewMutationError("Unauthorized", 401),
    );
    const res = await POST(makePost({ engineeringViewB: true }));
    expect(res.status).toBe(401);
  });

  it("propagates 403 from setEngineeringViewB for non-CEO callers", async () => {
    mockSet.mockRejectedValue(
      new EngineeringViewMutationError("Forbidden", 403),
    );
    const res = await POST(makePost({ engineeringViewB: true }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("calls setEngineeringViewB and returns the new resolution for a real CEO", async () => {
    mockSet.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
      effectiveRole: "ceo",
      impersonatedEmail: null,
      viewerEmail: null,
    });

    const res = await POST(makePost({ engineeringViewB: true }));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(true);

    const body = await res.json();
    expect(body).toEqual({
      surface: "b-side",
      actualCeo: true,
      toggleOn: true,
    });
  });

  it("persists false for a real CEO", async () => {
    mockSet.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({
      surface: "a-side",
      actualCeo: true,
      toggleOn: false,
      effectiveRole: "ceo",
      impersonatedEmail: null,
      viewerEmail: null,
    });

    const res = await POST(makePost({ engineeringViewB: false }));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(false);
  });
});
