import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect, execute: mockExecute },
}));

vi.mock("@/lib/db/schema", () => ({
  pageViews: {
    id: "id",
    clerkUserId: "clerkUserId",
    path: "path",
    viewedAt: "viewedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  gte: vi.fn(),
  desc: vi.fn((v) => v),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      template: strings,
      values,
      as: (alias: string) => ({ alias }),
    }),
    {
      raw: vi.fn(),
    }
  ),
  count: vi.fn(() => ({ as: (alias: string) => ({ alias }) })),
  countDistinct: vi.fn(() => ({ as: (alias: string) => ({ alias }) })),
}));

import {
  getDashboardDAU,
  getRecentPageViews,
} from "../dashboard-usage";

afterEach(() => {
  mockSelect.mockReset();
  mockExecute.mockReset();
});

function buildThrowingSelectChain(error: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "groupBy",
    "orderBy",
    "limit",
    "offset",
  ];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.then = (_resolve: (value: unknown) => void, reject: (e: unknown) => void) => {
    reject(error);
  };
  return chain;
}

describe("getDashboardDAU", () => {
  it("returns [] when the page_views table is missing (schema compat)", async () => {
    const missingTable = Object.assign(new Error("relation \"page_views\" does not exist"), {
      code: "42P01",
    });
    mockSelect.mockImplementation(() => buildThrowingSelectChain(missingTable));

    await expect(getDashboardDAU()).resolves.toEqual([]);
  });

  it("surfaces transient pg failures as DatabaseUnavailableError", async () => {
    mockSelect.mockImplementation(() =>
      buildThrowingSelectChain(new Error("fetch failed"))
    );

    await expect(getDashboardDAU()).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});

describe("getRecentPageViews", () => {
  it("returns the empty fallback when page_views is missing", async () => {
    const missingTable = Object.assign(new Error("relation \"page_views\" does not exist"), {
      code: "42P01",
    });
    mockSelect.mockImplementation(() => buildThrowingSelectChain(missingTable));

    await expect(getRecentPageViews(1, 50)).resolves.toEqual({
      rows: [],
      total: 0,
    });
  });

  it("surfaces transient pg failures as DatabaseUnavailableError", async () => {
    mockSelect.mockImplementation(() =>
      buildThrowingSelectChain(new Error("connection terminated unexpectedly"))
    );

    await expect(getRecentPageViews(1, 50)).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });
});
