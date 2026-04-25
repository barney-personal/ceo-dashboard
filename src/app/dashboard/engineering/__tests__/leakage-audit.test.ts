/**
 * B-side leakage audit (M13).
 *
 * Static + behavioural assertions that B-side data and UI cannot reach a
 * non-CEO viewer through any path under `/dashboard/engineering`. The audit
 * has two layers:
 *
 *  1. **Source-tree audit**: B-side namespace (`@/components/dashboard/engineering-b/`)
 *     is imported by exactly one production file (`src/app/dashboard/engineering/layout.tsx`)
 *     and that file gates the render on `getEngineeringViewResolution()`.
 *  2. **Resolver audit**: The canonical authorization helper resolves to
 *     `surface === "b-side"` ONLY for an actual CEO with the toggle on.
 *
 * If a future cycle adds a new B-side route, page, or loader, the source-tree
 * audit will catch the new entry point and force the engineer to add it to
 * the allowlist OR route it through the resolver.
 */

import { readFileSync, statSync } from "fs";
import { join } from "path";
import { glob } from "glob";
import { describe, expect, it, vi } from "vitest";

import { getEngineeringViewResolution } from "@/lib/auth/engineering-view.server";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");

vi.mock("@/lib/auth/current-user.server", () => ({
  getCurrentUserWithTimeout: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
  })),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(),
}));

import { getCurrentUserWithTimeout } from "@/lib/auth/current-user.server";

describe("B-side leakage audit (M13) — source tree", () => {
  /**
   * Production files allowed to import `engineering-b/...`. Test files and
   * the engineering-b namespace itself are excluded by glob filtering. If you
   * are adding a new entry point, prefer routing through the layout's
   * `getEngineeringViewResolution()` gate; if that is not possible, append
   * the file here AND add a behavioural test that the new path is gated.
   */
  const ALLOWED_IMPORTERS = new Set<string>([
    "src/app/dashboard/engineering/layout.tsx",
  ]);

  it("only the engineering layout imports the B-side namespace", async () => {
    const candidates = await glob("src/**/*.{ts,tsx}", {
      cwd: ROOT,
      ignore: [
        "**/__tests__/**",
        "src/components/dashboard/engineering-b/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/node_modules/**",
      ],
    });

    const offenders: string[] = [];
    for (const rel of candidates) {
      const path = join(ROOT, rel);
      if (statSync(path).isDirectory()) continue;
      const text = readFileSync(path, "utf-8");
      const imports =
        /from\s+["']@?\/?components\/dashboard\/engineering-b/.test(text) ||
        /require\(["']@?\/?components\/dashboard\/engineering-b/.test(text);
      if (!imports) continue;
      if (ALLOWED_IMPORTERS.has(rel)) continue;
      offenders.push(rel);
    }

    expect(
      offenders,
      `Unexpected B-side importers detected. Add to ALLOWED_IMPORTERS only after confirming the new path routes through getEngineeringViewResolution(). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the engineering layout gates the B-side root on getEngineeringViewResolution()", () => {
    const layout = readFileSync(
      join(ROOT, "src/app/dashboard/engineering/layout.tsx"),
      "utf-8",
    );
    expect(layout).toContain("getEngineeringViewResolution");
    expect(layout).toMatch(/engineeringView\.surface\s*===\s*"b-side"/);
    expect(layout).toMatch(/<EngineeringBRoot/);
  });

  it("no API route exposes the B-side composite or methodology metadata", async () => {
    const apiFiles = await glob("src/app/api/**/route.{ts,tsx}", {
      cwd: ROOT,
      ignore: ["**/node_modules/**"],
    });
    const offenders: string[] = [];
    for (const rel of apiFiles) {
      const text = readFileSync(join(ROOT, rel), "utf-8");
      if (
        /engineering-composite|engineering-b/.test(text) &&
        !rel.endsWith("engineering-view/route.ts")
      ) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `API route(s) reference the B-side composite or namespace: ${offenders.join(", ")}. Add an explicit allowlist entry only after confirming the route is CEO-gated.`,
    ).toEqual([]);
  });
});

describe("B-side leakage audit (M13) — resolver", () => {
  function authedAs({
    role,
    engineeringViewB = false,
  }: {
    role: string;
    engineeringViewB?: boolean;
  }) {
    // Sticky for the duration of the test — getEngineeringViewResolution()
    // can call getCurrentUserWithTimeout() more than once (the resolver itself
    // plus getImpersonation() under the hood), and mockResolvedValueOnce
    // would leak undefined into the second call.
    vi.mocked(getCurrentUserWithTimeout).mockResolvedValue({
      status: "authenticated",
      user: {
        id: "user_test",
        publicMetadata: { role, engineeringViewB },
      },
    } as unknown as Awaited<ReturnType<typeof getCurrentUserWithTimeout>>);
  }

  it("anonymous → a-side", async () => {
    vi.mocked(getCurrentUserWithTimeout).mockResolvedValue({
      status: "unauthenticated",
    } as unknown as Awaited<ReturnType<typeof getCurrentUserWithTimeout>>);
    const r = await getEngineeringViewResolution();
    expect(r.surface).toBe("a-side");
    expect(r.actualCeo).toBe(false);
  });

  it.each<["everyone" | "manager" | "engineering_manager" | "leadership"]>([
    ["everyone"],
    ["manager"],
    ["engineering_manager"],
    ["leadership"],
  ])(
    "non-CEO with engineeringViewB true → a-side (%s)",
    async (role) => {
      authedAs({ role, engineeringViewB: true });
      const r = await getEngineeringViewResolution();
      expect(r.surface).toBe("a-side");
      expect(r.actualCeo).toBe(false);
      expect(r.toggleOn).toBe(false);
    },
  );

  it("CEO with toggle off → a-side", async () => {
    authedAs({ role: "ceo", engineeringViewB: false });
    const r = await getEngineeringViewResolution();
    expect(r.surface).toBe("a-side");
    expect(r.actualCeo).toBe(true);
    expect(r.toggleOn).toBe(false);
  });

  it("CEO with toggle on, no impersonation, no demoting preview → b-side", async () => {
    authedAs({ role: "ceo", engineeringViewB: true });
    const r = await getEngineeringViewResolution();
    expect(r.surface).toBe("b-side");
    expect(r.actualCeo).toBe(true);
    expect(r.toggleOn).toBe(true);
  });
});
