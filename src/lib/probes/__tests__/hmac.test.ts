// @vitest-environment node
import { describe, expect, it } from "vitest";

import { signPayload, verifyPayload } from "../hmac";

const SECRET = "test-secret-abc123";
const PREV_SECRET = "prev-secret-xyz789";
const PAYLOAD = JSON.stringify({ probeId: "cloud-cron", status: "green" });

describe("signPayload / verifyPayload", () => {
  it("round-trip: signed payload verifies successfully", () => {
    const { signature, ts } = signPayload(PAYLOAD, SECRET);
    expect(verifyPayload(PAYLOAD, signature, ts, SECRET)).toBe(true);
  });

  it("bad signature: forged signature is rejected", () => {
    const { ts } = signPayload(PAYLOAD, SECRET);
    expect(verifyPayload(PAYLOAD, "deadbeef".repeat(8), ts, SECRET)).toBe(
      false
    );
  });

  it("stale timestamp: skew > 5 minutes is rejected", () => {
    const { signature } = signPayload(PAYLOAD, SECRET);
    const staleTs = Math.floor(Date.now() / 1000) - 6 * 60; // 6 min ago
    expect(verifyPayload(PAYLOAD, signature, staleTs, SECRET)).toBe(false);
  });

  it("future timestamp: skew > 5 minutes in future is rejected", () => {
    const { signature } = signPayload(PAYLOAD, SECRET);
    const futureTs = Math.floor(Date.now() / 1000) + 6 * 60; // 6 min ahead
    expect(verifyPayload(PAYLOAD, signature, futureTs, SECRET)).toBe(false);
  });

  it("previous secret rotation: payload signed with previous secret is accepted", () => {
    const { signature, ts } = signPayload(PAYLOAD, PREV_SECRET);
    expect(verifyPayload(PAYLOAD, signature, ts, SECRET, PREV_SECRET)).toBe(
      true
    );
  });

  it("previous secret rotation: payload signed with previous secret is rejected without prevSecret arg", () => {
    const { signature, ts } = signPayload(PAYLOAD, PREV_SECRET);
    expect(verifyPayload(PAYLOAD, signature, ts, SECRET)).toBe(false);
  });

  it("tampered payload: altered body fails verification", () => {
    const { signature, ts } = signPayload(PAYLOAD, SECRET);
    const tamperedPayload = JSON.stringify({ probeId: "evil", status: "red" });
    expect(verifyPayload(tamperedPayload, signature, ts, SECRET)).toBe(false);
  });
});
