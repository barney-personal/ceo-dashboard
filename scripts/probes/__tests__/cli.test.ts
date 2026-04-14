// @vitest-environment node
import { describe, it, expect } from "vitest";
import { loadManifest, resolveChecks, formatSummaryName } from "../../probe";
import { resolve } from "path";

const MANIFEST_PATH = resolve(__dirname, "../manifest.yaml");

describe("probe CLI contract", () => {
  describe("formatSummaryName", () => {
    it("maps --all to probe-all for machine-readable output", () => {
      expect(formatSummaryName("--all")).toBe("probe-all");
    });

    it("preserves suite names", () => {
      expect(formatSummaryName("ceo-15m-suite")).toBe("ceo-15m-suite");
    });

    it("preserves individual check names", () => {
      expect(formatSummaryName("ceo-ping-auth")).toBe("ceo-ping-auth");
    });
  });

  describe("resolveChecks", () => {
    it("resolves --all to every check in manifest", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "--all");
      expect(checks).toEqual(
        expect.arrayContaining(["ceo-ping-auth", "ceo-clerk-playwright"])
      );
      expect(checks).toHaveLength(Object.keys(manifest.checks).length);
    });

    it("resolves a suite to its check list", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "ceo-15m-suite");
      expect(checks).toEqual(["ceo-ping-auth"]);
    });

    it("resolves a single check name to itself", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "ceo-ping-auth");
      expect(checks).toEqual(["ceo-ping-auth"]);
    });

    it("throws on unknown name", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      expect(() => resolveChecks(manifest, "nonexistent")).toThrow(
        /Unknown check or suite/
      );
    });
  });

  describe("loadManifest", () => {
    it("loads and parses the YAML manifest", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      expect(manifest.suites).toBeDefined();
      expect(manifest.checks).toBeDefined();
      expect(manifest.checks["ceo-ping-auth"]).toMatchObject({
        handler: expect.any(String),
        timeout_ms: expect.any(Number),
      });
    });

    it("throws on missing file", () => {
      expect(() => loadManifest("/nonexistent/path.yaml")).toThrow();
    });
  });
});
