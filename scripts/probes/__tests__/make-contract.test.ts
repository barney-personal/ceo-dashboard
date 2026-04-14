// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../..");

function make(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`make ${args}`, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

function makeDryRun(args: string): string {
  return make(`-n ${args}`).stdout;
}

describe("Makefile probe contract", () => {
  describe("make probe SUITE=<name>", () => {
    it("generates a command invoking probe.sh with the suite name", () => {
      const output = makeDryRun("probe SUITE=ceo-15m-suite");
      expect(output).toContain("probe.sh");
      expect(output).toContain("ceo-15m-suite");
    });

    it("forwards PROBE_FLAGS to probe.sh without Make intercepting them", () => {
      const output = makeDryRun(
        "probe SUITE=ceo-ping-auth PROBE_FLAGS='--dry-run --target=staging'"
      );
      expect(output).toContain("--dry-run");
      expect(output).toContain("--target=staging");
    });
  });

  describe("make probe-all", () => {
    it("generates a command invoking probe.sh with --all", () => {
      const output = makeDryRun("probe-all");
      expect(output).toContain("probe.sh");
      expect(output).toContain("--all");
    });

    it("forwards PROBE_FLAGS including --target to probe.sh", () => {
      const output = makeDryRun(
        "probe-all PROBE_FLAGS='--target=staging --dry-run'"
      );
      expect(output).toContain("--target=staging");
      expect(output).toContain("--dry-run");
    });
  });

  describe("make probe without SUITE", () => {
    it("exits non-zero with a usage message", () => {
      const result = make("probe");
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/SUITE/i);
    });
  });

  describe("no catch-all target", () => {
    it("rejects unknown targets instead of silently succeeding", () => {
      const result = make("nonexistent-target-xyz");
      expect(result.exitCode).not.toBe(0);
    });
  });
});
