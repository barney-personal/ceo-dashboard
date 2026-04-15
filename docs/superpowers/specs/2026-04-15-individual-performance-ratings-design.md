# Individual Performance Ratings

Replace the Performance page iframe embed with a native drill-down view showing individual performance ratings across review cycles. CEO only.

## Data Source

Mode report `79ea96d310a9` (Performance Dashboard), query `manager_distributions_individual_ratings` (token `0ab8e05bec08`).

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `review_cycle_name` | string | e.g. "2025 H2-B Performance Review" |
| `reviewer_name` | string | Manager who reviewed |
| `current_slt_representative_name` | string | SLT representative |
| `function` | string | Department (Marketing, Product, Engineering, etc.) |
| `employee_email` | string | Unique identifier, joins with employee data |
| `performance_rating` | number \| null | 1-5 scale, null = missed review |
| `flagged_review` | 0 \| 1 | Whether the review was flagged |
| `missed_review` | 0 \| 1 | Whether the review was missed |
| `counter` | 1 | Always 1 (row counter) |

### Available Review Cycles (as of April 2026)

- 2025 H1-A Performance Check-In (254 rows)
- 2025 H1-B Performance Review (275 rows)
- 2025 H2-A Performance Check-In (296 rows)
- 2025 H2-B Performance Review (345 rows)

Total: ~1170 rows. This will grow as new cycles are added in Mode.

## Changes

### 1. Enable Mode Sync

In `src/lib/integrations/mode-config.ts`, update the Performance Dashboard profile:

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

Snapshot storage means each sync replaces the previous data (no historical accumulation needed — the query itself returns all cycles).

### 2. Data Loader — `src/lib/data/performance.ts`

New module, separate from `people.ts` to keep concerns clean.

#### Types

```ts
interface PerformanceRating {
  reviewCycle: string;        // "2025 H2-B Performance Review"
  rating: number | null;      // 1-5 or null
  reviewerName: string;
  flagged: boolean;
  missed: boolean;
}

interface PersonPerformance {
  email: string;
  name: string;               // from employee data join
  jobTitle: string;            // from employee data join
  level: string;              // from employee data join
  squad: string;              // from employee data join
  pillar: string;             // from employee data join
  function: string;           // from Mode performance data
  ratings: PerformanceRating[];
}
```

#### Functions

- `getPerformanceData()` — fetches synced Mode data, joins with active employees (by email) to get squad/pillar/name/level, returns `PersonPerformance[]` and the list of review cycle names (sorted chronologically).
- `groupPerformanceByPillar(data: PersonPerformance[])` — groups into pillar -> squad hierarchy with aggregate distribution stats at each level.
- `groupPerformanceByFunction(data: PersonPerformance[])` — groups by function (department) for the alternate view.
- `getRatingDistribution(ratings: PerformanceRating[], cycle?: string)` — returns counts per rating (1-5) plus missed/flagged counts, optionally filtered to a single cycle.

Employee join: use `getActiveEmployees()` from `people.ts` for name/squad/pillar/level. If the employee isn't in the active list (they may have left), use `employee_email` as the name, the Mode `function` field as both function and pillar, and empty strings for squad/level/jobTitle. These former employees will still appear in their function's group in the "By Department" view but won't appear in the pillar/squad drill-down (since they have no squad assignment).

### 3. UI — Replace Performance Page

**Route:** `/dashboard/people/performance` (existing, CEO only)

**File:** `src/app/dashboard/people/performance/page.tsx` — server component that fetches data and passes to client component.

**Component:** `src/components/dashboard/performance-drilldown.tsx` — client component with drill-down state.

#### View Toggle

Two views at the top, matching the org page pattern:
- **By Pillar** (default) — Pillar -> Squad -> Individual
- **By Department** — Function -> Individual

#### Level 1: Pillar/Department Overview

Grid of cards (one per pillar or department). Each card shows:
- Name and headcount
- Stacked horizontal bar showing rating distribution for the most recent cycle (colour-coded: 1=red, 2=orange, 3=amber, 4=green, 5=dark-green)
- Average rating (small text)

Click a card to drill into it.

#### Level 2: Squad View (pillar path only)

Same card layout but for squads within the selected pillar. Same distribution bars. Back button to return to pillar overview.

#### Level 3: Individual Table

Table of people in the selected squad/department. Columns:
- Name
- Level
- One column per review cycle, showing the rating as a colour-coded badge (1-5)
- Flagged/missed indicators (small icons)

Sortable by name and by any cycle's rating. Search filter for name.

Click a row to see person detail.

#### Level 4: Person Detail

Card showing:
- Name, job title, level, squad, pillar, function
- Rating timeline: each cycle as a row with rating badge, reviewer name, flagged/missed status
- Visual trend (simple inline sparkline or coloured dots showing trajectory)

Back button returns to the table.

#### Colour Scale for Ratings

| Rating | Colour | Label |
|--------|--------|-------|
| 5 | `#16a34a` (green-600) | Exceptional |
| 4 | `#65a30d` (lime-600) | Strong |
| 3 | `#ca8a04` (yellow-600) | Meeting expectations |
| 2 | `#ea580c` (orange-600) | Below expectations |
| 1 | `#dc2626` (red-600) | Significantly below |
| null | `#9ca3af` (gray-400) | Missed |

### 4. Access Control

The performance page already requires `leadership` role. Change this to `ceo` only:
- Update the route check in `src/lib/auth/routes.ts` (if route-level gating exists)
- Add `requireRole("ceo")` check in the page server component
- Update sidebar visibility so only CEO sees the Performance nav item

### 5. Tests

- `src/lib/data/__tests__/performance.test.ts` — unit tests for the data loader: grouping, distribution calculation, employee join, handling missing employees
- Update existing route/auth tests if the role requirement changes

### 6. Files Changed

| File | Change |
|------|--------|
| `src/lib/integrations/mode-config.ts` | Enable sync, add query |
| `src/lib/data/performance.ts` | New data loader module |
| `src/app/dashboard/people/performance/page.tsx` | Replace iframe with server data fetch + client component |
| `src/components/dashboard/performance-drilldown.tsx` | New drill-down client component |
| `src/lib/auth/routes.ts` | Update performance route to CEO only (if needed) |
| `src/lib/data/__tests__/performance.test.ts` | New tests |

### 7. What This Does NOT Include

- Historical data beyond what Mode returns (currently 4 cycles in 2025)
- Editing or submitting reviews
- Comparison to company averages (could add later)
- Export/download functionality
