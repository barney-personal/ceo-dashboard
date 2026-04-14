import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProbeCanary } from "../probe-canary";

describe("ProbeCanary", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("renders canary with CANARY_EXPECTED_VALUE from env", () => {
    process.env.CANARY_EXPECTED_VALUE = "ceo-dashboard-alive-2026";
    const result = ProbeCanary();

    expect(result.props["data-testid"]).toBe("probe-canary");
    expect(result.props.children).toBe("ceo-dashboard-alive-2026");
  });

  it("uses default placeholder when env is not set", () => {
    delete process.env.CANARY_EXPECTED_VALUE;
    const result = ProbeCanary();

    expect(result.props.children).toBe("ceo-dashboard-canary-ok");
  });

  it("uses default placeholder when env is empty string", () => {
    process.env.CANARY_EXPECTED_VALUE = "";
    const result = ProbeCanary();

    expect(result.props.children).toBe("ceo-dashboard-canary-ok");
  });

  it("is visually hidden with aria-hidden and sr-only", () => {
    process.env.CANARY_EXPECTED_VALUE = "test-canary";
    const result = ProbeCanary();

    expect(result.props["aria-hidden"]).toBe("true");
    expect(result.props.className).toContain("sr-only");
  });

  it("renders a span element", () => {
    const result = ProbeCanary();
    expect(result.type).toBe("span");
  });

  it("contains only the canary text (no customer data)", () => {
    process.env.CANARY_EXPECTED_VALUE = "safe-static-value";
    const result = ProbeCanary();

    expect(result.props.children).toBe("safe-static-value");
    expect(typeof result.props.children).toBe("string");
  });
});
