// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CheckContext } from "../../probe";

describe("ceo-ping-auth check", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
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

  it("returns green when ping-auth responds with db_ok: true", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: 1.5,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.details).toMatchObject({ db_ok: true });
  });

  it("returns red when ping-auth responds with db_ok: false", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: false,
        version: null,
        mode_sync_age_hours: null,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("red");
    expect(result.error).toMatch(/db_ok.*false/i);
  });

  it("returns red when fetch returns non-ok HTTP status", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("red");
    expect(result.error).toMatch(/502/);
  });

  it("returns red when fetch throws a network error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED")
    );

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("red");
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("includes mode_sync_age_hours in details when present", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: 3.2,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.details).toMatchObject({ mode_sync_age_hours: 3.2 });
  });

  it("hits the correct URL based on baseUrl", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "v1",
        mode_sync_age_hours: 1.0,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    await run(makeCtx({ baseUrl: "https://custom.example.com" }));

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://custom.example.com/api/probes/ping-auth");
  });

  it("returns red when deploying is true", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: 1.0,
        deploying: true,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("red");
    expect(result.error).toMatch(/deploying/i);
  });

  it("returns red when version is null", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: null,
        mode_sync_age_hours: 1.0,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/version/i);
    expect(result.details).toMatchObject({ db_ok: true });
  });

  it("returns red when version is empty string", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "",
        mode_sync_age_hours: 2.0,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/version/i);
    expect(result.details).toMatchObject({ db_ok: true });
  });

  it("returns red when mode_sync_age_hours is null", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: null,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/mode.sync/i);
    expect(result.details).toMatchObject({ db_ok: true });
  });

  it("returns red when mode_sync_age_hours >= 26", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: 26,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.status).toBe("red");
    expect(result.error).toMatch(/mode.sync/i);
    expect(result.details).toMatchObject({ mode_sync_age_hours: 26 });
  });

  it("returns green when mode_sync_age_hours is just under 26", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        db_ok: true,
        version: "abc1234",
        mode_sync_age_hours: 25.9,
        deploying: false,
        ts: "2026-04-14T00:00:00Z",
      }),
    });

    const { run } = await import("../checks/ceo-ping-auth");
    const result = await run(makeCtx());

    expect(result.status).toBe("green");
    expect(result.details).toMatchObject({ mode_sync_age_hours: 25.9 });
  });
});
