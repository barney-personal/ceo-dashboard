import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/probes/hmac", () => ({
  verifyPayload: vi.fn(),
}));

vi.mock("@/lib/probes/repo", () => ({
  insertProbeRun: vi.fn(),
}));

vi.mock("@/lib/probes/alerter", () => ({
  runAlerter: vi.fn(),
}));

import { verifyPayload } from "@/lib/probes/hmac";
import { insertProbeRun } from "@/lib/probes/repo";
import { runAlerter } from "@/lib/probes/alerter";
import { POST } from "../route";

const mockVerify = vi.mocked(verifyPayload);
const mockInsert = vi.mocked(insertProbeRun);
const mockAlerter = vi.mocked(runAlerter);

const VALID_BODY = {
  probeId: "ceo-15m",
  checkName: "ceo-ping-auth",
  status: "green",
  latencyMs: 120,
  details: { version: "abc123" },
};

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/probes/report", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("POST /api/probes/report", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("PROBE_SECRET", "test-secret");
    mockInsert.mockResolvedValue({ id: 1, ts: new Date() });
    mockAlerter.mockResolvedValue(undefined);
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
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=abc123",
      })
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

  it("returns 400 for invalid JSON body", async () => {
    mockVerify.mockReturnValue(true);
    const req = new Request("http://localhost/api/probes/report", {
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

  it("returns 400 when required fields are missing", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(
        { probeId: "test" },
        {
          "X-Probe-Signature": "sha256=validsig",
          "X-Probe-Timestamp": "1700000000",
        }
      )
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("returns 201 and inserts run for valid signed payload", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe(1);
    expect(mockInsert).toHaveBeenCalledWith({
      probeId: "ceo-15m",
      checkName: "ceo-ping-auth",
      status: "green",
      latencyMs: 120,
      details: { version: "abc123" },
    });
  });

  it("triggers alerter asynchronously without blocking response", async () => {
    mockVerify.mockReturnValue(true);
    let alerterResolved = false;
    mockAlerter.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            alerterResolved = true;
            resolve(undefined);
          }, 50);
        })
    );

    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(201);
    // Alerter was called but may not have resolved yet (fire-and-forget)
    expect(mockAlerter).toHaveBeenCalledWith("ceo-ping-auth");
    // Response returned before alerter finished — this is the async contract
    expect(alerterResolved).toBe(false);
  });

  it("returns 201 even if alerter throws", async () => {
    mockVerify.mockReturnValue(true);
    mockAlerter.mockRejectedValue(new Error("telegram down"));
    const res = await POST(
      makeRequest(VALID_BODY, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(201);
  });

  it("accepts payload with optional runId and target fields", async () => {
    mockVerify.mockReturnValue(true);
    const body = {
      ...VALID_BODY,
      runId: "run-abc",
      target: "prod",
    };
    const res = await POST(
      makeRequest(body, {
        "X-Probe-Signature": "sha256=validsig",
        "X-Probe-Timestamp": "1700000000",
      })
    );
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-abc",
        target: "prod",
      })
    );
  });
});
