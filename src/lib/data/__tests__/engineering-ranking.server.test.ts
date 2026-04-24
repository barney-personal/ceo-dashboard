import { beforeEach, describe, expect, it, vi } from "vitest";
import { SQL, StringChunk } from "drizzle-orm";

/**
 * Flatten a Drizzle SQL expression into a single string of literal text. We
 * only need enough fidelity to check for the `excluded.<column>` reference, so
 * walking `StringChunk`s is sufficient — any nested SQL or identifier chunks
 * recursively surface their literal text.
 */
function flattenSqlLiteralText(node: unknown): string {
  if (node instanceof SQL) {
    return node.queryChunks.map((chunk) => flattenSqlLiteralText(chunk)).join("");
  }
  if (node instanceof StringChunk) {
    return node.value.join("");
  }
  if (typeof node === "string") return node;
  return "";
}

vi.mock("@/lib/db", () => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    db: {
      insert,
      select: vi.fn(),
    },
    __mocks: { insert, values, onConflictDoUpdate },
  };
});

import { db } from "@/lib/db";
import { persistRankingSnapshot } from "../engineering-ranking.server";
import {
  buildRankingSnapshot,
  hashEmailForRanking,
  type EligibilityEntry,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type PerEngineerSignalRow,
} from "../engineering-ranking";

function competitiveEntry(
  index: number,
  overrides: Partial<EligibilityEntry> = {},
): EligibilityEntry {
  const email = `eng${index}@meetcleo.com`;
  return {
    emailHash: hashEmailForRanking(email),
    displayName: `Engineer ${index}`,
    email,
    githubLogin: `eng${index}`,
    discipline: "BE",
    levelLabel: "L4",
    squad: index % 2 === 0 ? "Platform" : "Risk",
    pillar: "Core",
    canonicalSquad: null,
    manager: "Boss",
    startDate: "2023-01-01",
    tenureDays: 800,
    isLeaverOrInactive: false,
    hasImpactModelRow: true,
    eligibility: "competitive",
    reason: "Eligible",
    ...overrides,
  };
}

function signalRow(
  index: number,
  overrides: Partial<PerEngineerSignalRow> = {},
): PerEngineerSignalRow {
  return {
    emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
    prCount: 30 + index,
    commitCount: 60 + index * 2,
    additions: index * 100,
    deletions: index * 10,
    shapPredicted: index * 50,
    shapActual: index * 60,
    shapResidual: index * 10,
    aiTokens: index * 1_000,
    aiSpend: index * 5,
    squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
    squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
    squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
    squadPrsInProgress: index % 2 === 0 ? 6 : 9,
    ...overrides,
  };
}

function buildFixtureSnapshot() {
  const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
  const signals = entries.map((_, i) => signalRow(i + 1));
  const headcountRows: EligibilityHeadcountRow[] = entries.map((e) => ({
    email: e.email,
    preferred_name: e.displayName,
    rp_specialisation: "Backend Eng",
    hb_function: "Engineering",
    hb_level: e.levelLabel,
    job_title: e.levelLabel,
    hb_squad: e.squad ?? null,
    line_manager_email: "boss@meetcleo.com",
    manager: e.manager,
    start_date: e.startDate,
  }));
  const githubMap: EligibilityGithubMapRow[] = entries
    .filter((e): e is EligibilityEntry & { githubLogin: string } =>
      Boolean(e.githubLogin),
    )
    .map((e) => ({
      githubLogin: e.githubLogin,
      employeeEmail: e.email,
      isBot: false,
    }));
  const impactModel: EligibilityImpactModelView = {
    engineers: entries.map((e) => ({
      email_hash: e.emailHash,
      predicted: 1,
      actual: 1,
    })),
  };
  const snapshot = buildRankingSnapshot({
    headcountRows,
    githubMap,
    impactModel,
    signals,
    now: new Date("2026-04-24T12:34:56Z"),
    reviewSignalsPersisted: false,
  });
  return { snapshot, signals };
}

describe("persistRankingSnapshot (M17 persistence correctness)", () => {
  beforeEach(() => {
    vi.mocked(db.insert).mockClear();
    // Re-wire the fluent chain each test so captured calls stay isolated.
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    vi.mocked(db.insert).mockReturnValue({
      values,
    } as unknown as ReturnType<typeof db.insert>);
  });

  it("populates a non-null input_hash in the persisted values when signals are supplied", async () => {
    const { snapshot, signals } = buildFixtureSnapshot();
    await persistRankingSnapshot(snapshot, { signals });

    const insertCall = vi.mocked(db.insert).mock.results[0];
    const valuesFn = (insertCall.value as { values: ReturnType<typeof vi.fn> })
      .values;
    const writtenValues = valuesFn.mock.calls[0][0] as Array<{
      inputHash: string | null;
    }>;

    // The live POST path used to call persistRankingSnapshot without signals,
    // which nulled every row's input_hash. The fix routes the signals through
    // the API and populates the per-engineer hash here.
    expect(Array.isArray(writtenValues)).toBe(true);
    expect(writtenValues.length).toBeGreaterThan(0);
    const hashes = writtenValues.map((row) => row.inputHash);
    expect(hashes.every((hash) => hash !== null && typeof hash === "string")).toBe(
      true,
    );
    // Distinct signals must produce distinct hashes so movers can
    // distinguish input drift from methodology drift.
    expect(new Set(hashes).size).toBeGreaterThan(1);
  });

  it("ON CONFLICT DO UPDATE set values pull from PostgreSQL EXCLUDED, not the existing row", async () => {
    const { snapshot, signals } = buildFixtureSnapshot();
    await persistRankingSnapshot(snapshot, { signals });

    const insertCall = vi.mocked(db.insert).mock.results[0];
    const valuesFn = (insertCall.value as { values: ReturnType<typeof vi.fn> })
      .values;
    const valuesResult = valuesFn.mock.results[0].value as {
      onConflictDoUpdate: ReturnType<typeof vi.fn>;
    };
    const onConflictArg = valuesResult.onConflictDoUpdate.mock.calls[0][0] as {
      set: Record<string, unknown>;
    };
    const setClause = onConflictArg.set;

    // Every refreshable column must be an SQL instance referencing the
    // EXCLUDED pseudo-row. The previous bug assigned Drizzle column objects
    // (engineeringRankingSnapshots.<col>), which PostgreSQL evaluates as
    // "target_table.<col>" — a no-op on same-day refresh.
    const refreshableColumns = [
      "signalWindowStart",
      "signalWindowEnd",
      "eligibilityStatus",
      "rank",
      "compositeScore",
      "adjustedPercentile",
      "rawPercentile",
      "methodA",
      "methodB",
      "methodC",
      "confidenceLow",
      "confidenceHigh",
      "inputHash",
      "metadata",
      "generatedAt",
    ] as const;

    for (const column of refreshableColumns) {
      const value = setClause[column];
      expect(
        value instanceof SQL,
        `set.${column} must be an sql\`excluded.<column>\` expression`,
      ).toBe(true);
      // The SQL fragment must literally reference excluded.<snake_case>.
      const fragment = flattenSqlLiteralText(value).toLowerCase();
      expect(fragment).toContain("excluded.");
    }
  });

  it("emits no database write when the snapshot has no composite entries", async () => {
    // Empty snapshot — no headcount, no signals, no composite entries. A bare
    // no-op insert with zero rows is a legitimate same-day refresh when the
    // methodology surfaces the empty-eligibility stub, but the DB must not be
    // asked to upsert anything.
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });

    await persistRankingSnapshot(snapshot, { signals: [] });
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});
