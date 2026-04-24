import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEV_PREVIEW_ALLOWED_DOMAIN,
  getDevPreviewUserEmail,
  isDevPreviewEnabled,
} from "../dev-preview";

describe("getDevPreviewUserEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when NODE_ENV is production, even with the env var set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_PREVIEW_USER_EMAIL", `barney@${DEV_PREVIEW_ALLOWED_DOMAIN}`);
    expect(getDevPreviewUserEmail()).toBeNull();
    expect(isDevPreviewEnabled()).toBe(false);
  });

  it("returns null when the env var is unset in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_PREVIEW_USER_EMAIL", "");
    expect(getDevPreviewUserEmail()).toBeNull();
    expect(isDevPreviewEnabled()).toBe(false);
  });

  it("returns null when the email is outside the allowed domain", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_PREVIEW_USER_EMAIL", "attacker@evil.com");
    expect(getDevPreviewUserEmail()).toBeNull();
    expect(isDevPreviewEnabled()).toBe(false);
  });

  it("returns null for emails on a similar but distinct domain", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_PREVIEW_USER_EMAIL", "user@notmeetcleo.com");
    expect(getDevPreviewUserEmail()).toBeNull();
  });

  it("returns the lowercased email when all gates pass", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DEV_PREVIEW_USER_EMAIL",
      `Barney@${DEV_PREVIEW_ALLOWED_DOMAIN.toUpperCase()}`
    );
    expect(getDevPreviewUserEmail()).toBe(
      `barney@${DEV_PREVIEW_ALLOWED_DOMAIN}`
    );
    expect(isDevPreviewEnabled()).toBe(true);
  });

  it("trims whitespace from the env var value", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DEV_PREVIEW_USER_EMAIL",
      `  barney@${DEV_PREVIEW_ALLOWED_DOMAIN}  `
    );
    expect(getDevPreviewUserEmail()).toBe(
      `barney@${DEV_PREVIEW_ALLOWED_DOMAIN}`
    );
  });
});
