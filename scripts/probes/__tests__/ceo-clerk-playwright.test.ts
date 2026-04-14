// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CheckContext } from "../../probe";

const mockScreenshot = vi.fn();
const mockTextContent = vi.fn();
const mockLocator = vi.fn();
const mockGoto = vi.fn();
const mockNewPage = vi.fn();
const mockAddCookies = vi.fn();
const mockNewContext = vi.fn();
const mockBrowserClose = vi.fn();
const mockLaunch = vi.fn();

vi.mock("@playwright/test", () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

describe("ceo-clerk-playwright check", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockLocator.mockReturnValue({ textContent: mockTextContent });
    mockNewPage.mockResolvedValue({
      goto: mockGoto,
      locator: mockLocator,
      screenshot: mockScreenshot,
    });
    mockAddCookies.mockResolvedValue(undefined);
    mockNewContext.mockResolvedValue({
      newPage: mockNewPage,
      addCookies: mockAddCookies,
    });
    mockBrowserClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: mockNewContext,
      close: mockBrowserClose,
    });
    mockGoto.mockResolvedValue(undefined);
    mockTextContent.mockResolvedValue("ceo-dashboard-canary-ok");
    mockScreenshot.mockResolvedValue(Buffer.from("png-data"));

    process.env.CLERK_TEST_TOKEN = "test-clerk-token-123";
    process.env.CANARY_EXPECTED_VALUE = "ceo-dashboard-canary-ok";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function makeCtx(overrides: Partial<CheckContext> = {}): CheckContext {
    return {
      target: "prod",
      probeSecret: "test-secret",
      baseUrl: "https://ceo-dashboard.onrender.com",
      sign: () => ({ signature: "sig", ts: 1000 }),
      ...overrides,
    };
  }

  it("returns green when canary matches expected value", async () => {
    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-clerk-playwright");
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.details).toMatchObject({ canaryValue: "ceo-dashboard-canary-ok" });
  });

  it("returns red with skipped when CLERK_TEST_TOKEN is missing", async () => {
    delete process.env.CLERK_TEST_TOKEN;

    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/CLERK_TEST_TOKEN/);
    expect(result.details).toMatchObject({ skipped: true, reason: "missing config" });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("uses default canary value when CANARY_EXPECTED_VALUE is unset", async () => {
    delete process.env.CANARY_EXPECTED_VALUE;

    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.status).toBe("green");
    expect(result.details).toMatchObject({ canaryValue: "ceo-dashboard-canary-ok" });
  });

  it("returns red on auth/navigation failure with screenshot metadata", async () => {
    mockGoto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));

    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/ERR_CONNECTION_REFUSED/);
    expect(result.details?.screenshot).toMatchObject({
      path: expect.stringContaining("playwright-failure"),
    });
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("returns red on canary mismatch with expected/actual and screenshot", async () => {
    mockTextContent.mockResolvedValue("wrong-canary-value");

    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/canary mismatch/);
    expect(result.details).toMatchObject({
      canaryExpected: "ceo-dashboard-canary-ok",
      canaryActual: "wrong-canary-value",
    });
    expect(result.details?.screenshot).toBeDefined();
    expect(mockScreenshot).toHaveBeenCalled();
  });

  it("records screenshot error when screenshot itself fails", async () => {
    mockGoto.mockRejectedValue(new Error("timeout"));
    mockScreenshot.mockRejectedValue(new Error("no page to screenshot"));

    const { run } = await import("../checks/ceo-clerk-playwright");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.details?.screenshot).toMatchObject({
      error: "no page to screenshot",
    });
  });

  it("navigates to the correct dashboard URL using baseUrl", async () => {
    const { run } = await import("../checks/ceo-clerk-playwright");
    await run(makeCtx({ baseUrl: "https://custom.example.com" }));

    expect(mockGoto).toHaveBeenCalledWith(
      "https://custom.example.com/dashboard",
      expect.objectContaining({ waitUntil: "networkidle" }),
    );
  });

  it("sets Clerk testing token cookie with correct domain", async () => {
    const { run } = await import("../checks/ceo-clerk-playwright");
    await run(makeCtx({ baseUrl: "https://my-app.onrender.com" }));

    expect(mockAddCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "__clerk_db_jwt",
        value: "test-clerk-token-123",
        domain: "my-app.onrender.com",
      }),
    ]);
  });

  it("always closes browser even on error", async () => {
    mockGoto.mockRejectedValue(new Error("crash"));

    const { run } = await import("../checks/ceo-clerk-playwright");
    await run(makeCtx());

    expect(mockBrowserClose).toHaveBeenCalled();
  });
});
