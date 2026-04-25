# Engineering surface interactive-element count

**Owner:** Implementer (Cycle 13)
**Methodology version:** `b-1.0.0`
**Date:** 2026-04-24
**Reproducer:** `npx tsx scripts/count-engineering-interactives.ts`

The M13 acceptance gate requires B-side to ship with ≤ 50% of A-side's
interactive surface. This worklog records the latest count.

## How the count is produced

`scripts/count-engineering-interactives.ts` greps the engineering
production source for JSX-flavoured interactive shapes and tallies them
by category:

- `buttons` — `<Button>`, `<button>`, `<IconButton>`
- `links` — `<Link>`, `<NextLink>`, `<a href=...>`
- `tabs` — `<Tabs>`, `<TabsTrigger>`, `<TabsList>`
- `selects-and-radios` — `<Select>`, `<SelectTrigger>`, `<RadioGroup>`,
  `<RadioGroupItem>`, `<select>`
- `inputs-and-forms` — `<Input>`, `<input>`, `<textarea>`, `<Switch>`,
  `<Checkbox>`, `<DatePicker>`
- `row-expanders-and-disclosures` — `<details>`, `<Collapsible>`,
  `<Accordion>`, `aria-expanded=`
- `menus-and-dropdowns` — `<DropdownMenu>`, `<DropdownMenuTrigger>`,
  `<Popover>`, `<PopoverTrigger>`

Test files and the `engineering-b/__tests__/` namespace are excluded.

A-side scope:
- `src/app/dashboard/engineering/**/*.{ts,tsx}` (excluding layout/page
  shell and tests)
- `src/components/dashboard/engineering-tabs.tsx` — A-side only,
  hidden under B-side surface

B-side scope:
- `src/components/dashboard/engineering-b/*.{ts,tsx}` and
  subdirectories

## Latest run

```
=== A-side (legacy /dashboard/engineering) ===
Total interactive elements: 50
By category:
  buttons                              26
  links                                17
  tabs                                 0
  selects-and-radios                   2
  inputs-and-forms                     1
  row-expanders-and-disclosures        4
  menus-and-dropdowns                  0

Top 10 files by interactive count:
    20  src/app/dashboard/engineering/code-review/_components/code-review-report.tsx
     7  src/app/dashboard/engineering/ranking/_components/composite-table.tsx
     4  src/app/dashboard/engineering/impact-model/_components/outlier-table.tsx
     3  src/app/dashboard/engineering/engineers/[login]/_components/engineer-code-review-section.tsx
     3  src/app/dashboard/engineering/engineers/[login]/page.tsx
     3  src/app/dashboard/engineering/ranking/_components/hr-review-section.tsx
     2  src/app/dashboard/engineering/impact-model/_components/shap-waterfall.tsx
     2  src/app/dashboard/engineering/impact-model/_components/team-view.tsx
     1  src/app/dashboard/engineering/impact-model/_components/feature-deep-dive.tsx
     1  src/app/dashboard/engineering/impact/_components/watchlist.tsx

=== B-side (engineering-b/* components) ===
Total interactive elements: 3
By category:
  buttons                              2
  links                                0
  tabs                                 0
  selects-and-radios                   0
  inputs-and-forms                     0
  row-expanders-and-disclosures        1
  menus-and-dropdowns                  0

Top 10 files by interactive count:
     3  src/components/dashboard/engineering-b/stack-rank-table.tsx

=== Aggregate ===
A-side: 50
B-side: 3
Ratio (B / A): 6.0%

PASS: B-side is at or below 50% of A-side interactive elements
(M13 simplification gate).
```

## What this means in practice

- **A-side surface (50)** — the existing engineering section is built
  out across 8 routes (delivery-health, engineers, pillars, squads,
  impact, impact-model, code-review, ranking) and three CEO-only
  sub-surfaces (`ranking/methodology`, `ranking/hr-review`,
  `code-review`). The interactive density is concentrated in the rank
  / code-review explorers, which is where most of the cognitive load
  lives. The tabs surface (`EngineeringTabs`) accounts for the route
  switcher itself.

- **B-side surface (3)** — the entire B-side has three interactives,
  all on `stack-rank-table.tsx`: one row expander button per row
  (counted once by static grep), one disclosure attribute
  (`aria-expanded`), and one icon button. The engineer view is a
  read-only landing page; the manager view is a read-only stack rank
  with row drilldowns. There are no toggles, filters, tabs, dropdowns,
  selects, modals, or sort buttons.

- **Ratio (B / A) = 6.0%**, well under the 50% gate.

## Caveats and known limitations

- The count is a static grep; one shadcn `<Button>` rendered inside a
  `.map()` over N rows reads as "1" interactive even though the user
  ultimately sees N. That bias is consistent across A- and B-side and
  the ratio is therefore not distorted in B-side's favour. (If we
  shipped a pillar filter that rendered 12 chips, that would still
  count as one interactive shape in our static count.)
- The script counts production source only. It excludes
  `__tests__/**`, `*.test.ts`, and `*.test.tsx`.
- The CEO toggle (`EngineeringViewToggle`) is the gate between A- and
  B-side and is **not** counted on either side. It belongs to the M4
  surface gate, not to either persona view.
- The Swarmia link in the engineering layout is hidden when B-side is
  active. It is currently counted in neither column because the layout
  is not in the A-side glob. If we tighten the count to include the
  layout's a-side branch, A-side would gain +1 link; the ratio is
  unaffected.

## Reproducing the count

```
npx tsx scripts/count-engineering-interactives.ts
```

The script exits non-zero if the ratio breaches 50%. Run it before
opening the M14 PR; record any change here as an append-only entry.
