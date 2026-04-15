# Individual Performance Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Performance page iframe embed with a native drill-down view showing individual performance ratings across review cycles, accessible to CEO only.

**Architecture:** Enable Mode sync for the `manager_distributions_individual_ratings` query (snapshot storage). New `performance.ts` data loader joins ratings with active employee data. New `performance-drilldown.tsx` client component provides Pillar → Squad → Individual and Department → Individual drill-down views, matching existing org page patterns.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Vitest, D3.js colour scales, existing Mode sync infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-15-individual-performance-ratings-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/integrations/mode-config.ts` | Enable sync + add query for Performance Dashboard |
| `src/lib/data/performance.ts` | Data loader: fetch ratings, join with employees, group by pillar/squad/function |
| `src/lib/data/__tests__/performance.test.ts` | Unit tests for data loader |
| `src/components/dashboard/performance-drilldown.tsx` | Client drill-down component (pillar/dept views, rating badges, person detail) |
| `src/app/dashboard/people/performance/page.tsx` | Server component: fetch data, enforce CEO role, pass to client component |
| `src/components/dashboard/sidebar.tsx` | Change Performance nav item from `leadership` to `ceo` |

---

### Task 1: Enable Mode Sync for Performance Dashboard

**Files:**
- Modify: `src/lib/integrations/mode-config.ts:310-317`

- [ ] **Step 1: Update the Performance Dashboard sync profile**

In `src/lib/integrations/mode-config.ts`, find the Performance Dashboard entry (around line 310) and change it from:

```ts
  {
    reportToken: "79ea96d310a9",
    name: "Performance Dashboard",
    section: "people",
    category: "performance",
    syncEnabled: false,
    queries: [],
  },
```

to:

```ts
  {
    reportToken: "79ea96d310a9",
    name: "Performance Dashboard",
    section: "people",
    category: "performance",
    syncEnabled: true,
    queries: [
      {
        name: "manager_distributions_individual_ratings",
        storageWindow: { kind: "snapshot" },
      },
    ],
  },
```

- [ ] **Step 2: Verify no existing tests break**

Run: `make test`
Expected: All existing tests pass. The mode-config tests may reference the performance report — ensure they still pass with the new config.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/mode-config.ts
git commit -m "feat(mode): enable sync for Performance Dashboard individual ratings query"
```

---

### Task 2: Data Loader — Types and Core Functions

**Files:**
- Create: `src/lib/data/performance.ts`
- Create: `src/lib/data/__tests__/performance.test.ts`

- [ ] **Step 1: Write failing tests for `getRatingDistribution`**

Create `src/lib/data/__tests__/performance.test.ts`.

Note: We set up mocks for `../mode` and `../people` from the start even though Task 2 doesn't need them yet. This is because Task 3 will add `import { rowStr, ... } from "./mode"` to `performance.ts`, and at that point all tests in this file would fail without mocks (mode.ts has DB dependencies). Setting them up now avoids restructuring the file later.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetReportData } = vi.hoisted(() => ({
  mockGetReportData: vi.fn(),
}));

vi.mock("../mode", () => ({
  getReportData: mockGetReportData,
  rowStr: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "string" ? row[key] : row[key] != null ? String(row[key]) : "",
  rowNum: (row: Record<string, unknown>, key: string, fallback = 0) =>
    typeof row[key] === "number" ? row[key] : fallback,
  rowNumOrNull: (row: Record<string, unknown>, key: string) =>
    typeof row[key] === "number" ? row[key] : null,
}));

const { mockGetActiveEmployees } = vi.hoisted(() => ({
  mockGetActiveEmployees: vi.fn(),
}));

vi.mock("../people", () => ({
  getActiveEmployees: mockGetActiveEmployees,
}));

import {
  getRatingDistribution,
  type PerformanceRating,
} from "../performance";

function makeRating(overrides: Partial<PerformanceRating> = {}): PerformanceRating {
  return {
    reviewCycle: "2025 H2-B Performance Review",
    rating: 4,
    reviewerName: "Manager A",
    flagged: false,
    missed: false,
    ...overrides,
  };
}

describe("getRatingDistribution", () => {
  it("counts ratings 1-5 and missed", () => {
    const ratings: PerformanceRating[] = [
      makeRating({ rating: 5 }),
      makeRating({ rating: 4 }),
      makeRating({ rating: 4 }),
      makeRating({ rating: 3 }),
      makeRating({ rating: null, missed: true }),
    ];
    const dist = getRatingDistribution(ratings);
    expect(dist).toEqual({
      1: 0,
      2: 0,
      3: 1,
      4: 2,
      5: 1,
      missed: 1,
      flagged: 0,
      total: 5,
    });
  });

  it("filters by cycle when provided", () => {
    const ratings: PerformanceRating[] = [
      makeRating({ reviewCycle: "2025 H2-B Performance Review", rating: 5 }),
      makeRating({ reviewCycle: "2025 H1-B Performance Review", rating: 3 }),
    ];
    const dist = getRatingDistribution(ratings, "2025 H2-B Performance Review");
    expect(dist).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 1,
      missed: 0,
      flagged: 0,
      total: 1,
    });
  });

  it("returns zeros for empty input", () => {
    const dist = getRatingDistribution([]);
    expect(dist.total).toBe(0);
    expect(dist[5]).toBe(0);
  });

  it("counts flagged reviews", () => {
    const ratings = [makeRating({ flagged: true }), makeRating({ flagged: true })];
    const dist = getRatingDistribution(ratings);
    expect(dist.flagged).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: FAIL — module `../performance` does not exist.

- [ ] **Step 3: Create `performance.ts` with types and `getRatingDistribution`**

Create `src/lib/data/performance.ts`:

```ts
export interface PerformanceRating {
  reviewCycle: string;
  rating: number | null;
  reviewerName: string;
  flagged: boolean;
  missed: boolean;
}

export interface PersonPerformance {
  email: string;
  name: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  ratings: PerformanceRating[];
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  missed: number;
  flagged: number;
  total: number;
}

export function getRatingDistribution(
  ratings: PerformanceRating[],
  cycle?: string,
): RatingDistribution {
  const filtered = cycle
    ? ratings.filter((r) => r.reviewCycle === cycle)
    : ratings;

  const dist: RatingDistribution = {
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    missed: 0, flagged: 0, total: filtered.length,
  };

  for (const r of filtered) {
    if (r.rating !== null && r.rating >= 1 && r.rating <= 5) {
      dist[r.rating as 1 | 2 | 3 | 4 | 5]++;
    }
    if (r.missed) dist.missed++;
    if (r.flagged) dist.flagged++;
  }

  return dist;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/performance.ts src/lib/data/__tests__/performance.test.ts
git commit -m "feat(data): add performance types and getRatingDistribution"
```

---

### Task 3: Data Loader — `transformPerformanceData` (joins Mode rows with employees)

**Files:**
- Modify: `src/lib/data/performance.ts`
- Modify: `src/lib/data/__tests__/performance.test.ts`

- [ ] **Step 1: Write failing tests for `transformPerformanceData`**

Update `src/lib/data/__tests__/performance.test.ts`:

First, update the existing import from `../performance` to also include the new exports:

```ts
import {
  getRatingDistribution,
  transformPerformanceData,
  type PerformanceRating,
  type PersonPerformance,
} from "../performance";
```

Note: `Person` type is NOT imported from `../people` because that module is mocked. Instead, define the Person shape inline via the `makePerson` helper.

Then add the `makePerson` helper and new describe block after the existing `getRatingDistribution` tests:

describe("transformPerformanceData", () => {
  it("joins Mode rows with employee data by email", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 4,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-B Performance Review",
        performance_rating: 3,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];

    const { people, reviewCycles } = transformPerformanceData(modeRows, employees);

    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("Alice Test");
    expect(people[0].squad).toBe("Payments");
    expect(people[0].pillar).toBe("Core");
    expect(people[0].ratings).toHaveLength(2);
    expect(people[0].ratings[0].rating).toBe(4);
    expect(people[0].ratings[1].rating).toBe(3);
    expect(reviewCycles).toEqual([
      "2025 H1-B Performance Review",
      "2025 H2-B Performance Review",
    ]);
  });

  it("handles employees not in active list (former employees)", () => {
    const modeRows = [
      {
        employee_email: "gone@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 2,
        reviewer_name: "Manager X",
        current_slt_representative_name: "VP",
        function: "Marketing",
        flagged_review: 1,
        missed_review: 0,
        counter: 1,
      },
    ];
    const employees: Person[] = [];

    const { people } = transformPerformanceData(modeRows, employees);

    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("gone@meetcleo.com");
    expect(people[0].function).toBe("Marketing");
    expect(people[0].squad).toBe("");
    expect(people[0].pillar).toBe("Marketing");
    expect(people[0].ratings[0].flagged).toBe(true);
  });

  it("handles null performance_rating as missed", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-A Performance Check-In",
        performance_rating: null,
        reviewer_name: "Bob Manager",
        current_slt_representative_name: "CTO",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 1,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];

    const { people } = transformPerformanceData(modeRows, employees);

    expect(people[0].ratings[0].rating).toBeNull();
    expect(people[0].ratings[0].missed).toBe(true);
  });

  it("sorts review cycles chronologically", () => {
    const modeRows = [
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H2-B Performance Review",
        performance_rating: 5,
        reviewer_name: "M",
        current_slt_representative_name: "S",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
      {
        employee_email: "alice@meetcleo.com",
        review_cycle_name: "2025 H1-A Performance Check-In",
        performance_rating: 3,
        reviewer_name: "M",
        current_slt_representative_name: "S",
        function: "Engineering",
        flagged_review: 0,
        missed_review: 0,
        counter: 1,
      },
    ];
    const employees = [makePerson({ email: "alice@meetcleo.com" })];

    const { reviewCycles } = transformPerformanceData(modeRows, employees);

    expect(reviewCycles).toEqual([
      "2025 H1-A Performance Check-In",
      "2025 H2-B Performance Review",
    ]);
  });
});
```

Update the import at top of file to also import `transformPerformanceData` and `Person`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: FAIL — `transformPerformanceData` is not exported.

- [ ] **Step 3: Implement `transformPerformanceData`**

Add to `src/lib/data/performance.ts`:

```ts
import type { Person } from "./people";
import { rowStr, rowNum, rowNumOrNull } from "./mode";

export function transformPerformanceData(
  modeRows: Record<string, unknown>[],
  employees: Person[],
): { people: PersonPerformance[]; reviewCycles: string[] } {
  const employeeByEmail = new Map<string, Person>();
  for (const emp of employees) {
    employeeByEmail.set(emp.email.toLowerCase(), emp);
  }

  // Group rows by email
  const byEmail = new Map<string, Record<string, unknown>[]>();
  const cycleSet = new Set<string>();

  for (const row of modeRows) {
    const email = rowStr(row, "employee_email").toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(row);
    const cycle = rowStr(row, "review_cycle_name");
    if (cycle) cycleSet.add(cycle);
  }

  const reviewCycles = [...cycleSet].sort();

  const people: PersonPerformance[] = [];

  for (const [email, rows] of byEmail) {
    const emp = employeeByEmail.get(email);
    const func = rowStr(rows[0], "function");

    const ratings: PerformanceRating[] = rows
      .map((row) => ({
        reviewCycle: rowStr(row, "review_cycle_name"),
        rating: rowNumOrNull(row, "performance_rating"),
        reviewerName: rowStr(row, "reviewer_name"),
        flagged: rowNum(row, "flagged_review") === 1,
        missed: rowNum(row, "missed_review") === 1,
      }))
      .sort((a, b) => a.reviewCycle.localeCompare(b.reviewCycle));

    people.push({
      email: emp?.email ?? email,
      name: emp?.name ?? email,
      jobTitle: emp?.jobTitle ?? "",
      level: emp?.level ?? "",
      squad: emp?.squad ?? "",
      pillar: emp?.pillar ?? func,
      function: func,
      ratings,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name));

  return { people, reviewCycles };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/performance.ts src/lib/data/__tests__/performance.test.ts
git commit -m "feat(data): add transformPerformanceData with employee join"
```

---

### Task 4: Data Loader — Grouping Functions

**Files:**
- Modify: `src/lib/data/performance.ts`
- Modify: `src/lib/data/__tests__/performance.test.ts`

- [ ] **Step 1: Write failing tests for grouping**

Update `src/lib/data/__tests__/performance.test.ts`:

First, update the import from `../performance` to also include the new exports:

```ts
import {
  getRatingDistribution,
  transformPerformanceData,
  groupPerformanceByPillar,
  groupPerformanceByFunction,
  type PerformanceRating,
  type PersonPerformance,
} from "../performance";
```

Then add the `makePersonPerf` helper and new describe blocks after the existing tests:

```ts
function makePersonPerf(overrides: Partial<PersonPerformance> = {}): PersonPerformance {
  return {
    email: "alice@meetcleo.com",
    name: "Alice Test",
    jobTitle: "Engineer",
    level: "L3",
    squad: "Payments",
    pillar: "Core",
    function: "Engineering",
    ratings: [makeRating()],
    ...overrides,
  };
}

describe("groupPerformanceByPillar", () => {
  it("groups people by pillar then squad", () => {
    const people = [
      makePersonPerf({ pillar: "Core", squad: "Payments", name: "Alice" }),
      makePersonPerf({ pillar: "Core", squad: "Payments", name: "Bob", email: "bob@meetcleo.com" }),
      makePersonPerf({ pillar: "Core", squad: "Banking", name: "Charlie", email: "charlie@meetcleo.com" }),
      makePersonPerf({ pillar: "Growth", squad: "SEO", name: "Diana", email: "diana@meetcleo.com" }),
    ];
    const groups = groupPerformanceByPillar(people);

    expect(groups).toHaveLength(2);
    // Core has 3 people, should come first (sorted by count desc)
    expect(groups[0].name).toBe("Core");
    expect(groups[0].count).toBe(3);
    expect(groups[0].squads).toHaveLength(2);
    expect(groups[1].name).toBe("Growth");
    expect(groups[1].count).toBe(1);
  });

  it("excludes people with no squad from pillar view", () => {
    const people = [
      makePersonPerf({ squad: "", pillar: "Marketing" }),
    ];
    const groups = groupPerformanceByPillar(people);
    expect(groups).toHaveLength(0);
  });
});

describe("groupPerformanceByFunction", () => {
  it("groups people by function", () => {
    const people = [
      makePersonPerf({ function: "Engineering", name: "Alice" }),
      makePersonPerf({ function: "Engineering", name: "Bob", email: "bob@meetcleo.com" }),
      makePersonPerf({ function: "Marketing", name: "Charlie", email: "charlie@meetcleo.com" }),
    ];
    const groups = groupPerformanceByFunction(people);

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe("Engineering");
    expect(groups[0].people).toHaveLength(2);
    expect(groups[1].name).toBe("Marketing");
    expect(groups[1].people).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: FAIL — `groupPerformanceByPillar` and `groupPerformanceByFunction` not exported.

- [ ] **Step 3: Implement grouping functions**

Add to `src/lib/data/performance.ts`:

```ts
export interface PerformancePillarGroup {
  name: string;
  count: number;
  squads: { name: string; people: PersonPerformance[] }[];
}

export interface PerformanceFunctionGroup {
  name: string;
  people: PersonPerformance[];
}

export function groupPerformanceByPillar(
  people: PersonPerformance[],
): PerformancePillarGroup[] {
  // Exclude people with no squad (former employees without org assignment)
  const withSquad = people.filter((p) => p.squad !== "");

  const byPillar = new Map<string, Map<string, PersonPerformance[]>>();

  for (const person of withSquad) {
    if (!byPillar.has(person.pillar)) byPillar.set(person.pillar, new Map());
    const squads = byPillar.get(person.pillar)!;
    if (!squads.has(person.squad)) squads.set(person.squad, []);
    squads.get(person.squad)!.push(person);
  }

  return [...byPillar.entries()]
    .map(([pillarName, squads]) => {
      const squadList = [...squads.entries()]
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([squadName, people]) => ({ name: squadName, people }));
      return {
        name: pillarName,
        count: squadList.reduce((s, sq) => s + sq.people.length, 0),
        squads: squadList,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function groupPerformanceByFunction(
  people: PersonPerformance[],
): PerformanceFunctionGroup[] {
  const byFunc = new Map<string, PersonPerformance[]>();

  for (const person of people) {
    const func = person.function || "Unknown";
    if (!byFunc.has(func)) byFunc.set(func, []);
    byFunc.get(func)!.push(person);
  }

  return [...byFunc.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([name, people]) => ({ name, people }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/performance.ts src/lib/data/__tests__/performance.test.ts
git commit -m "feat(data): add performance grouping by pillar/squad and function"
```

---

### Task 5: Data Loader — `getPerformanceData` (async fetcher)

**Files:**
- Modify: `src/lib/data/performance.ts`
- Modify: `src/lib/data/__tests__/performance.test.ts`

- [ ] **Step 1: Write failing tests for `getPerformanceData`**

Update the import from `../performance` to also include `getPerformanceData`:

```ts
import {
  getRatingDistribution,
  transformPerformanceData,
  groupPerformanceByPillar,
  groupPerformanceByFunction,
  getPerformanceData,
  type PerformanceRating,
  type PersonPerformance,
} from "../performance";
```

Then add the test block. The `mockGetReportData` and `mockGetActiveEmployees` mocks are already set up from Task 2 — just use them:

```ts
describe("getPerformanceData", () => {
  beforeEach(() => {
    mockGetReportData.mockReset();
    mockGetActiveEmployees.mockReset();
  });

  it("fetches Mode data and joins with employees", async () => {
    mockGetReportData.mockResolvedValue([
      {
        reportName: "Performance Dashboard",
        section: "people",
        category: "performance",
        queryName: "manager_distributions_individual_ratings",
        columns: [],
        rows: [
          {
            employee_email: "alice@meetcleo.com",
            review_cycle_name: "2025 H2-B Performance Review",
            performance_rating: 4,
            reviewer_name: "Bob",
            current_slt_representative_name: "CTO",
            function: "Engineering",
            flagged_review: 0,
            missed_review: 0,
            counter: 1,
          },
        ],
        rowCount: 1,
        syncedAt: new Date("2026-04-15"),
      },
    ]);

    mockGetActiveEmployees.mockResolvedValue({
      employees: [
        {
          name: "Alice Test",
          email: "alice@meetcleo.com",
          jobTitle: "Engineer",
          level: "L3",
          squad: "Payments",
          pillar: "Core",
          function: "Engineering",
          manager: "Bob",
          startDate: "2024-01-01",
          location: "London",
          tenureMonths: 28,
          employmentType: "FTE",
        },
      ],
      partTimeChampions: [],
      unassigned: [],
      allRows: [],
      lastSync: new Date(),
    });

    const result = await getPerformanceData();

    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Alice Test");
    expect(result.people[0].ratings[0].rating).toBe(4);
    expect(result.reviewCycles).toContain("2025 H2-B Performance Review");
    expect(mockGetReportData).toHaveBeenCalledWith(
      "people",
      "performance",
      ["manager_distributions_individual_ratings"],
    );
  });

  it("returns empty when no Mode data", async () => {
    mockGetReportData.mockResolvedValue([]);
    mockGetActiveEmployees.mockResolvedValue({
      employees: [],
      partTimeChampions: [],
      unassigned: [],
      allRows: [],
      lastSync: null,
    });

    const result = await getPerformanceData();

    expect(result.people).toHaveLength(0);
    expect(result.reviewCycles).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: FAIL — `getPerformanceData` not exported or not implemented.

- [ ] **Step 3: Implement `getPerformanceData`**

Add to `src/lib/data/performance.ts`. First, update the existing imports at the top of the file to include `getReportData` and `getActiveEmployees`:

```ts
import { getReportData, rowStr, rowNum, rowNumOrNull } from "./mode";
import { getActiveEmployees, type Person } from "./people";
```

Note: `rowStr`, `rowNum`, `rowNumOrNull`, and `Person` were already imported in Task 3. Just add `getReportData` and `getActiveEmployees` to those existing imports.

Then add the function:

```ts
export async function getPerformanceData(): Promise<{
  people: PersonPerformance[];
  reviewCycles: string[];
}> {
  const [reportData, { employees }] = await Promise.all([
    getReportData("people", "performance", [
      "manager_distributions_individual_ratings",
    ]),
    getActiveEmployees(),
  ]);

  const query = reportData.find(
    (d) => d.queryName === "manager_distributions_individual_ratings",
  );

  if (!query || query.rows.length === 0) {
    return { people: [], reviewCycles: [] };
  }

  return transformPerformanceData(query.rows, employees);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/__tests__/performance.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/performance.ts src/lib/data/__tests__/performance.test.ts
git commit -m "feat(data): add getPerformanceData async fetcher"
```

---

### Task 6: Update Sidebar Role — Performance to CEO Only

**Files:**
- Modify: `src/components/dashboard/sidebar.tsx:105-108`

- [ ] **Step 1: Change the Performance nav item required role**

In `src/components/dashboard/sidebar.tsx`, find the Performance item (around line 105) and change `requiredRole` from `"leadership"` to `"ceo"`:

```ts
      {
        label: "Performance",
        href: "/dashboard/people/performance",
        requiredRole: "ceo",
        icon: TrendingUp,
      },
```

- [ ] **Step 2: Run tests to check for sidebar/route test impacts**

Run: `make test`
Expected: All tests pass. If any test asserts the Performance route requires `leadership`, update it to `ceo`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/sidebar.tsx
git commit -m "feat(auth): restrict Performance page to CEO only"
```

---

### Task 7: Performance Drilldown Client Component

**Files:**
- Create: `src/components/dashboard/performance-drilldown.tsx`

This is the largest task. The component handles 4 drill-down levels across 2 view modes.

- [ ] **Step 1: Create the component file with types and rating colour helpers**

Create `src/components/dashboard/performance-drilldown.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { Search, ArrowLeft, Users, Briefcase, TrendingUp, AlertTriangle, Flag } from "lucide-react";

interface PerformanceRating {
  reviewCycle: string;
  rating: number | null;
  reviewerName: string;
  flagged: boolean;
  missed: boolean;
}

interface PersonPerformance {
  email: string;
  name: string;
  jobTitle: string;
  level: string;
  squad: string;
  pillar: string;
  function: string;
  ratings: PerformanceRating[];
}

interface PillarGroup {
  name: string;
  count: number;
  squads: { name: string; people: PersonPerformance[] }[];
}

interface FunctionGroup {
  name: string;
  people: PersonPerformance[];
}

interface PerformanceDrilldownProps {
  pillarGroups: PillarGroup[];
  functionGroups: FunctionGroup[];
  reviewCycles: string[];
}

const RATING_COLOURS: Record<number, string> = {
  5: "#16a34a",
  4: "#65a30d",
  3: "#ca8a04",
  2: "#ea580c",
  1: "#dc2626",
};
const MISSED_COLOUR = "#9ca3af";

const RATING_LABELS: Record<number, string> = {
  5: "Exceptional",
  4: "Strong",
  3: "Meeting expectations",
  2: "Below expectations",
  1: "Significantly below",
};

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: MISSED_COLOUR }}
        title="Missed"
      >
        —
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: RATING_COLOURS[rating] ?? MISSED_COLOUR }}
      title={RATING_LABELS[rating] ?? `Rating ${rating}`}
    >
      {rating}
    </span>
  );
}

function DistributionBar({
  ratings,
  cycle,
}: {
  ratings: PerformanceRating[];
  cycle: string;
}) {
  const cycleRatings = ratings.filter((r) => r.reviewCycle === cycle);
  if (cycleRatings.length === 0) return null;

  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let missed = 0;
  for (const r of cycleRatings) {
    if (r.rating !== null && r.rating >= 1 && r.rating <= 5) {
      counts[r.rating]++;
    } else {
      missed++;
    }
  }
  const total = cycleRatings.length;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/30">
      {[1, 2, 3, 4, 5].map((rating) =>
        counts[rating] > 0 ? (
          <div
            key={rating}
            className="h-full transition-all"
            style={{
              width: `${(counts[rating] / total) * 100}%`,
              backgroundColor: RATING_COLOURS[rating],
            }}
            title={`${RATING_LABELS[rating]}: ${counts[rating]}`}
          />
        ) : null,
      )}
      {missed > 0 && (
        <div
          className="h-full"
          style={{
            width: `${(missed / total) * 100}%`,
            backgroundColor: MISSED_COLOUR,
          }}
          title={`Missed: ${missed}`}
        />
      )}
    </div>
  );
}

/** Short label from full cycle name, e.g. "2025 H2-B Performance Review" → "H2-B" */
function shortCycleLabel(cycle: string): string {
  const match = cycle.match(/H\d-[AB]/);
  return match ? match[0] : cycle;
}
```

- [ ] **Step 2: Add the main component with view toggle and pillar overview**

Append to the same file:

```tsx
export function PerformanceDrilldown({
  pillarGroups,
  functionGroups,
  reviewCycles,
}: PerformanceDrilldownProps) {
  const [view, setView] = useState<"pillar" | "department">("pillar");
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonPerformance | null>(null);
  const [search, setSearch] = useState("");

  const latestCycle = reviewCycles[reviewCycles.length - 1] ?? "";

  const activePillar = pillarGroups.find((p) => p.name === selectedPillar);
  const activeSquad = activePillar?.squads.find((s) => s.name === selectedSquad);
  const activeFunction = functionGroups.find((f) => f.name === selectedFunction);

  // Collect all ratings across all people in a group for distribution bars
  function collectRatings(people: PersonPerformance[]): PerformanceRating[] {
    return people.flatMap((p) => p.ratings);
  }

  const filteredPeople = useMemo(() => {
    const source = activeSquad?.people ?? activeFunction?.people ?? [];
    if (!search.trim()) return source;
    const q = search.toLowerCase();
    return source.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.jobTitle.toLowerCase().includes(q) ||
        p.level.toLowerCase().includes(q),
    );
  }, [activeSquad, activeFunction, search]);

  function resetState() {
    setSelectedPillar(null);
    setSelectedSquad(null);
    setSelectedFunction(null);
    setSelectedPerson(null);
    setSearch("");
  }

  // ── Person detail view ──
  if (selectedPerson) {
    const backLabel = activeSquad?.name ?? activeFunction?.name ?? "Back";
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedPerson(null)}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>

        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-warm space-y-5">
          <div>
            <h3 className="text-xl font-semibold text-foreground">{selectedPerson.name}</h3>
            {selectedPerson.jobTitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{selectedPerson.jobTitle}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {selectedPerson.level && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">{selectedPerson.level}</span>}
              {selectedPerson.squad && <span>{selectedPerson.squad}</span>}
              {selectedPerson.pillar && <span>· {selectedPerson.pillar}</span>}
              <span>· {selectedPerson.function}</span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Rating History
            </h4>
            <div className="divide-y divide-border/30 rounded-lg border border-border/40">
              {reviewCycles.map((cycle) => {
                const rating = selectedPerson.ratings.find((r) => r.reviewCycle === cycle);
                return (
                  <div key={cycle} className="flex items-center gap-4 px-4 py-3">
                    <RatingBadge rating={rating?.rating ?? null} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{cycle}</p>
                      {rating && (
                        <p className="text-xs text-muted-foreground">
                          Reviewed by {rating.reviewerName}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {rating?.flagged && (
                        <span className="flex items-center gap-1 text-xs text-orange-600" title="Flagged review">
                          <Flag className="h-3 w-3" />
                          Flagged
                        </span>
                      )}
                      {rating?.missed && (
                        <span className="flex items-center gap-1 text-xs text-gray-400" title="Missed review">
                          <AlertTriangle className="h-3 w-3" />
                          Missed
                        </span>
                      )}
                      {rating && rating.rating !== null && (
                        <span className="text-xs text-muted-foreground/60">
                          {RATING_LABELS[rating.rating]}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Individual table view (squad or function selected) ──
  if (activeSquad || activeFunction) {
    const groupName = activeSquad?.name ?? activeFunction?.name ?? "";
    const backLabel = activeSquad
      ? activePillar?.name ?? "Back"
      : "All departments";
    const onBack = () => {
      if (activeSquad) {
        setSelectedSquad(null);
      } else {
        setSelectedFunction(null);
      }
      setSearch("");
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
          <div>
            <h3 className="text-xl font-semibold text-foreground">{groupName}</h3>
            <span className="text-xs text-muted-foreground">
              {filteredPeople.length} people
            </span>
          </div>
        </div>

        {(activeSquad?.people ?? activeFunction?.people ?? []).length > 8 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm outline-none shadow-warm placeholder:text-muted-foreground/40 focus:border-primary/30"
            />
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-warm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">Level</th>
                {reviewCycles.map((cycle) => (
                  <th key={cycle} className="px-3 py-3 text-center font-medium text-muted-foreground">
                    {shortCycleLabel(cycle)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {filteredPeople.map((person) => (
                <tr
                  key={person.email}
                  onClick={() => setSelectedPerson(person)}
                  className="cursor-pointer transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{person.name}</span>
                    {person.jobTitle && (
                      <span className="ml-2 text-xs text-muted-foreground">{person.jobTitle}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {person.level && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {person.level}
                      </span>
                    )}
                  </td>
                  {reviewCycles.map((cycle) => {
                    const r = person.ratings.find((rt) => rt.reviewCycle === cycle);
                    return (
                      <td key={cycle} className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1">
                          <RatingBadge rating={r?.rating ?? null} />
                          {r?.flagged && <Flag className="h-3 w-3 text-orange-600" />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPeople.length === 0 && search.trim() && (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;</p>
          </div>
        )}
      </div>
    );
  }

  // ── Squad cards (pillar selected, no squad yet) ──
  if (activePillar && view === "pillar") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSelectedPillar(null); setSearch(""); }}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All pillars
          </button>
          <div>
            <h3 className="text-xl font-semibold text-foreground">{activePillar.name}</h3>
            <span className="text-xs text-muted-foreground">
              {activePillar.count} people · {activePillar.squads.length} squads
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {activePillar.squads.map((squad) => (
            <button
              key={squad.name}
              onClick={() => { setSelectedSquad(squad.name); setSearch(""); }}
              className="rounded-xl border border-border/60 bg-card p-4 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{squad.name}</span>
                <span className="text-xs text-muted-foreground">{squad.people.length}</span>
              </div>
              {latestCycle && (
                <div className="mt-3">
                  <DistributionBar ratings={collectRatings(squad.people)} cycle={latestCycle} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Top-level: pillar cards or department cards ──
  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setView("pillar"); resetState(); }}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            view === "pillar"
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By Pillar
        </button>
        <button
          onClick={() => { setView("department"); resetState(); }}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            view === "department"
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By Department
        </button>
      </div>

      {view === "pillar" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pillarGroups.map((pillar) => (
            <button
              key={pillar.name}
              onClick={() => setSelectedPillar(pillar.name)}
              className="group rounded-xl border border-border/60 bg-card p-5 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
            >
              <h4 className="text-base font-semibold text-foreground">{pillar.name}</h4>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {pillar.count} {pillar.count === 1 ? "person" : "people"}
                <span className="text-muted-foreground/50">
                  · {pillar.squads.length} {pillar.squads.length === 1 ? "squad" : "squads"}
                </span>
              </div>
              {latestCycle && (
                <div className="mt-3">
                  <DistributionBar ratings={collectRatings(pillar.squads.flatMap((s) => s.people))} cycle={latestCycle} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {view === "department" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {functionGroups.map((group) => (
            <button
              key={group.name}
              onClick={() => setSelectedFunction(group.name)}
              className="group rounded-xl border border-border/60 bg-card p-5 shadow-warm text-left transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg"
            >
              <h4 className="text-base font-semibold text-foreground">{group.name}</h4>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" />
                {group.people.length} {group.people.length === 1 ? "person" : "people"}
              </div>
              {latestCycle && (
                <div className="mt-3">
                  <DistributionBar ratings={collectRatings(group.people)} cycle={latestCycle} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify the component compiles**

Run: `npx tsc --noEmit src/components/dashboard/performance-drilldown.tsx 2>&1 | head -20`

If there are TS errors, fix them. Common issues: missing imports, type mismatches.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/performance-drilldown.tsx
git commit -m "feat(ui): add PerformanceDrilldown client component with pillar/dept views"
```

---

### Task 8: Replace Performance Page Server Component

**Files:**
- Modify: `src/app/dashboard/people/performance/page.tsx`

- [ ] **Step 1: Read the existing page**

Read `src/app/dashboard/people/performance/page.tsx` to confirm it's the iframe-only version (should be ~27 lines).

- [ ] **Step 2: Replace with server component that fetches data and enforces CEO role**

Replace the entire file content with:

```tsx
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { PerformanceDrilldown } from "@/components/dashboard/performance-drilldown";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import {
  getPerformanceData,
  groupPerformanceByPillar,
  groupPerformanceByFunction,
} from "@/lib/data/performance";
import { getModeReportLink } from "@/lib/integrations/mode-config";

export default async function PeoplePerformancePage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "ceo")) {
    redirect("/dashboard");
  }

  const { people, reviewCycles } = await getPerformanceData();
  const pillarGroups = groupPerformanceByPillar(people);
  const functionGroups = groupPerformanceByFunction(people);
  const modeUrl = getModeReportLink("people", "performance");

  // Serialize for client component (strip any non-POJO artifacts)
  const serializedPillars = pillarGroups.map((p) => ({
    name: p.name,
    count: p.count,
    squads: p.squads.map((s) => ({
      name: s.name,
      people: s.people.map((person) => ({
        email: person.email,
        name: person.name,
        jobTitle: person.jobTitle,
        level: person.level,
        squad: person.squad,
        pillar: person.pillar,
        function: person.function,
        ratings: person.ratings.map((r) => ({
          reviewCycle: r.reviewCycle,
          rating: r.rating,
          reviewerName: r.reviewerName,
          flagged: r.flagged,
          missed: r.missed,
        })),
      })),
    })),
  }));

  const serializedFunctions = functionGroups.map((g) => ({
    name: g.name,
    people: g.people.map((person) => ({
      email: person.email,
      name: person.name,
      jobTitle: person.jobTitle,
      level: person.level,
      squad: person.squad,
      pillar: person.pillar,
      function: person.function,
      ratings: person.ratings.map((r) => ({
        reviewCycle: r.reviewCycle,
        rating: r.rating,
        reviewerName: r.reviewerName,
        flagged: r.flagged,
        missed: r.missed,
      })),
    })),
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Performance"
        description="Individual performance ratings across review cycles"
      />

      {people.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No performance data available yet. Data will appear after the next Mode sync.
          </p>
        </div>
      ) : (
        <PerformanceDrilldown
          pillarGroups={serializedPillars}
          functionGroups={serializedFunctions}
          reviewCycles={reviewCycles}
        />
      )}

      {modeUrl && (
        <div className="flex justify-end">
          <a
            href={modeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground/60 underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
          >
            View in Mode
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors related to the performance page.

- [ ] **Step 4: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/people/performance/page.tsx
git commit -m "feat(ui): replace Performance iframe embed with native drill-down page"
```

---

### Task 9: Manual Verification and Final Commit

**Files:** None new — this is a verification task.

- [ ] **Step 1: Run full test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript compiler check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run linter**

Run: `npx next lint`
Expected: No errors (warnings acceptable).

- [ ] **Step 4: Verify dev server starts**

Run: `make dev` (in the main checkout directory where Doppler is configured)
Expected: Server starts without errors on port 3100.

- [ ] **Step 5: Push branch and create PR**

```bash
git push -u origin bh13731/individual-perf-ratings
gh pr create --title "feat: individual performance ratings drill-down" --body "$(cat <<'EOF'
## Summary
- Replace Performance page iframe embed with native drill-down view
- Enable Mode sync for `manager_distributions_individual_ratings` query
- Pillar → Squad → Individual and Department → Individual navigation
- CEO only access (previously leadership)

## Data
- Source: Mode report `79ea96d310a9`, query `manager_distributions_individual_ratings`
- 4 review cycles (2025 H1-A through H2-B), ~1170 rows
- Snapshot sync (latest data replaces previous on each sync)

## Test plan
- [ ] Unit tests for data loader (grouping, distribution, employee join)
- [ ] Verify Mode sync picks up the new query on next cron run
- [ ] Verify sidebar hides Performance from non-CEO users
- [ ] Test drill-down: Pillar → Squad → Table → Person detail
- [ ] Test drill-down: Department → Table → Person detail
- [ ] Verify rating badges colour correctly (1=red through 5=green)
- [ ] Verify former employees appear in Department view but not Pillar view

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
