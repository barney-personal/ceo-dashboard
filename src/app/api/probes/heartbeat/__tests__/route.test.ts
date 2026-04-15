import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/probes/hmac", () => ({
  verifyPayload: vi.fn(),
}));

vi.mock("@/lib/probes/repo", () => ({
  upsertHeartbeat: vi.fn(),
}));

import { verifyPayload } from "@/lib/probes/hmac";
import { upsertHeartbeat } from "@/lib/probes/repo";
import { POST } from "../route";

const mockVerify = vi.mocked(verifyPayload);
const mockUpsert = vi.mocked(upsertHeartbeat);

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/probes/heartbeat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const VALID_BODY = { probe_id: "ha-local" };
const VALID_BODY_CAMEL = { probeId: "ha-local" };

describe("POST /api/probes/heartbeat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("PROBE_SECRET", "test-secret");
    mockUpsert.mockResolvedValue(undefined);
  });

  it("returns 401 when X-Probe-Signature header is missing", async () => {
    const res = await POST(
      makeRequest(VALID_BODY, { "X-Probe-Timestamp": "1700000000" })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/signature/i);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Probe-Timestamp header is missing", async () => {
    const res = await POST(
      makeRequest(VALID_BODY, { "X-Probe-Signature": "sha256=abc" })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/timestamp/i);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 401 when PROBE_SECRET is not configured", async () => {
    vi.stubEnv("PROBE_SECRET", "");
    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=abc",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/secret/i);
  });

  it("returns 401 when signature verification fails", async () => {
    mockVerify.mockReturnValue(false);
    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=badsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
    expect(mockVerify).toHaveBeenCalledWith(
      JSON.stringify(VALID_BODY),
      "sha256=badsig",
      1700000000,
      "test-secret",
      undefined
    );
  });

  it("returns 400 for invalid JSON body", async () => {
    mockVerify.mockReturnValue(true);
    const req = new Request("http://localhost/api/probes/heartbeat", {
      method: "POST",
      body: "not json",
      headers: {
        "Content-Type": "application/json",
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither probe_id nor probeId is present", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { version: "abc123" },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/probe_id/i);
  });

  it("returns 204 for valid heartbeat without version", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(204);
    expect(mockUpsert).toHaveBeenCalledWith("ha-local", undefined);
  });

  it("returns 204 for valid heartbeat with version", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probe_id: "ha-local", version: "abc123" },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(204);
    expect(mockUpsert).toHaveBeenCalledWith("ha-local", "abc123");
  });

  it("calls upsertHeartbeat so repeated heartbeats update rather than duplicate", async () => {
    mockVerify.mockReturnValue(true);
    await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000001",
      })
    );
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenNthCalledWith(1, "ha-local", undefined);
    expect(mockUpsert).toHaveBeenNthCalledWith(2, "ha-local", undefined);
  });

  it("passes PROBE_SECRET_PREVIOUS as prevSecret to verifyPayload", async () => {
    vi.stubEnv("PROBE_SECRET_PREVIOUS", "old-secret");
    mockVerify.mockReturnValue(true);
    await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(mockVerify).toHaveBeenCalledWith(
      JSON.stringify(VALID_BODY),
      "sha256=validsig",
      1700000000,
      "test-secret",
      "old-secret"
    );
  });

  it("accepts camelCase probeId for backward compatibility", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(VALID_BODY_CAMEL, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(204);
    expect(mockUpsert).toHaveBeenCalledWith("ha-local", undefined);
  });

  it("prefers probe_id over probeId when both are present", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probe_id: "canonical-id", probeId: "legacy-id" },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(204);
    expect(mockUpsert).toHaveBeenCalledWith("canonical-id", undefined);
  });

  it("returns 400 when version is not a string", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probe_id: "ha-local", version: 12345 },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/version/i);
  });

  it("returns 400 when version is an object", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probe_id: "ha-local", version: { malicious: true } },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/version/i);
  });

  it("returns 400 when probe_id is empty string", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probe_id: "" },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/probe_id/i);
  });
});
