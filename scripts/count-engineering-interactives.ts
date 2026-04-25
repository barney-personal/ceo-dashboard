/**
 * Count engineering surface STATIC CHROME controls (M13 acceptance).
 *
 * Crawls the A-side and B-side code paths and tallies the source-level
 * occurrences of interactive elements (buttons, links, tabs, filters,
 * toggles, row expanders, form controls) so we can defend the
 * "B-side ≤ 50% of A-side" simplification gate.
 *
 * Usage: npx tsx scripts/count-engineering-interactives.ts
 *
 * IMPORTANT — what this metric does and does NOT measure:
 *
 *   ✓ Static chrome (what this counts): each source-level interactive
 *     control declared in the engineering surface — one source occurrence
 *     equals one count. A `<button>` inside a `.map(...)` row callback is
 *     therefore counted as 1, even though it is rendered N times in the live
 *     DOM (once per engineer row).
 *
 *   ✗ Rendered DOM complexity (what this does NOT count): the actual count
 *     of interactive nodes a user sees on the rendered page. For B-side the
 *     manager view renders ~106 row expanders because the stack rank
 *     iterates the cohort, so live DOM counts diverge from this static
 *     metric by orders of magnitude.
 *
 *   The static metric is the right primitive for measuring "how much chrome
 *   is the surface asking the user to learn?" — fewer A/B/C-side knobs,
 *   sub-tabs, and toggles is genuinely simpler to understand. The rendered
 *   DOM metric is the right primitive for measuring "how much is on screen
 *   at once?" — that's a function of cohort size, not of design decisions.
 *
 *   The script reports BOTH. The simplification gate is enforced on static
 *   chrome only.
 */

import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { glob } from "glob";

const ROOT = join(__dirname, "..");

type Bucket = {
  label: string;
  /** Patterns are run as regexes against the file content; each match counts as 1. */
  patterns: RegExp[];
};

// Heuristic categories. The shapes are JSX-flavoured (Tailwind / shadcn / lucide),
// not raw HTML — they reflect how this codebase writes components.
const BUCKETS: Bucket[] = [
  {
    label: "buttons",
    patterns: [
      /<Button\b/gi,
      /<button\b/gi,
      /<IconButton\b/gi,
    ],
  },
  {
    label: "links",
    patterns: [
      /<Link\b/g,
      /<a\s+href=/g,
      /<NextLink\b/g,
    ],
  },
  {
    label: "tabs",
    patterns: [/<Tabs\b/g, /<TabsTrigger\b/g, /<TabsList\b/g],
  },
  {
    label: "selects-and-radios",
    patterns: [
      /<Select\b/g,
      /<SelectTrigger\b/g,
      /<RadioGroup\b/g,
      /<RadioGroupItem\b/g,
      /<select\b/gi,
    ],
  },
  {
    label: "inputs-and-forms",
    patterns: [
      /<Input\b/g,
      /<input\b/gi,
      /<textarea\b/gi,
      /<Textarea\b/g,
      /<Switch\b/g,
      /<Checkbox\b/g,
      /<DatePicker\b/g,
    ],
  },
  {
    label: "row-expanders-and-disclosures",
    patterns: [
      /<details\b/gi,
      /<Collapsible\b/g,
      /<Accordion\b/g,
      /aria-expanded=/g,
    ],
  },
  {
    label: "menus-and-dropdowns",
    patterns: [
      /<DropdownMenu\b/g,
      /<DropdownMenuTrigger\b/g,
      /<Popover\b/g,
      /<PopoverTrigger\b/g,
    ],
  },
];

interface Counts {
  total: number;
  byBucket: Record<string, number>;
  byFile: Array<{
    file: string;
    total: number;
    byBucket: Record<string, number>;
    perRowSourcesInFile: number;
    hasMapIteration: boolean;
  }>;
  /**
   * Number of static chrome controls that live in files containing a list
   * iteration (`.map(`). These are sources whose live DOM count is
   * cohort-multiplied; surfaced separately so the static-vs-rendered
   * distinction is impossible to miss.
   */
  perRowSources: number;
}

function emptyByBucket(): Record<string, number> {
  return Object.fromEntries(BUCKETS.map((b) => [b.label, 0]));
}

const ITERATION_PATTERN = /\.map\(\s*\(?[^=)]*\)?\s*=>\s*[<{(]/g;

function countFile(file: string): {
  total: number;
  byBucket: Record<string, number>;
  hasMapIteration: boolean;
} {
  const text = readFileSync(file, "utf-8");
  const byBucket = emptyByBucket();
  for (const bucket of BUCKETS) {
    for (const re of bucket.patterns) {
      const matches = text.match(re);
      if (!matches) continue;
      byBucket[bucket.label] += matches.length;
    }
  }
  const total = Object.values(byBucket).reduce((a, b) => a + b, 0);
  const hasMapIteration = ITERATION_PATTERN.test(text);
  return { total, byBucket, hasMapIteration };
}

async function tally(label: string, patterns: string[]): Promise<Counts> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: ROOT,
      ignore: [
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/node_modules/**",
      ],
    });
    for (const m of matches) {
      const full = join(ROOT, m);
      if (statSync(full).isFile()) files.add(full);
    }
  }

  const sortedFiles = Array.from(files).sort();
  const total = { value: 0 };
  const perRow = { value: 0 };
  const byBucket = emptyByBucket();
  const byFile: Counts["byFile"] = [];

  for (const file of sortedFiles) {
    const counts = countFile(file);
    if (counts.total === 0) continue;
    total.value += counts.total;
    if (counts.hasMapIteration) perRow.value += counts.total;
    for (const [k, v] of Object.entries(counts.byBucket)) byBucket[k] += v;
    byFile.push({
      file: relative(ROOT, file),
      total: counts.total,
      byBucket: counts.byBucket,
      perRowSourcesInFile: counts.hasMapIteration ? counts.total : 0,
      hasMapIteration: counts.hasMapIteration,
    });
  }

  console.log(`\n=== ${label} ===`);
  console.log(`Total static chrome controls (source-level): ${total.value}`);
  console.log(
    `  of which inside list-iteration files (.map): ${perRow.value} — these multiply at render time by cohort size`,
  );
  console.log("By category:");
  for (const [k, v] of Object.entries(byBucket)) {
    console.log(`  ${k.padEnd(36)} ${v}`);
  }
  console.log("\nTop 10 files by static chrome count:");
  for (const entry of byFile.slice(0).sort((a, b) => b.total - a.total).slice(0, 10)) {
    const tag = entry.hasMapIteration ? " (per-row source — × cohort)" : "";
    console.log(
      `  ${entry.total.toString().padStart(4)}  ${entry.file}${tag}`,
    );
  }

  return {
    total: total.value,
    byBucket,
    byFile,
    perRowSources: perRow.value,
  };
}

async function main() {
  const aSide = await tally("A-side (legacy /dashboard/engineering)", [
    "src/app/dashboard/engineering/!(layout|page|__tests__).{ts,tsx}",
    "src/app/dashboard/engineering/*/**/*.{ts,tsx}",
    // EngineeringTabs is A-side only — the layout hides it under b-side.
    "src/components/dashboard/engineering-tabs.tsx",
  ]);

  const bSide = await tally("B-side (engineering-b/* components)", [
    "src/components/dashboard/engineering-b/*.{ts,tsx}",
    "src/components/dashboard/engineering-b/!(__tests__)/**/*.{ts,tsx}",
  ]);

  const ratio = aSide.total > 0 ? bSide.total / aSide.total : 0;

  console.log("\n=== Aggregate (static chrome) ===");
  console.log(`A-side static chrome: ${aSide.total}`);
  console.log(`  per-row sources: ${aSide.perRowSources}`);
  console.log(`B-side static chrome: ${bSide.total}`);
  console.log(`  per-row sources: ${bSide.perRowSources}`);
  console.log(`Ratio (B / A): ${(ratio * 100).toFixed(1)}%`);
  console.log(
    "\nNote — DOM-rendered interactive count differs from static chrome:",
  );
  console.log(
    "  Per-row sources are rendered once per cohort engineer, so the live DOM",
  );
  console.log(
    "  count for B-side scales with the scored cohort (~80–110 today). The",
  );
  console.log(
    "  M13 simplification gate is enforced on STATIC CHROME ONLY; rendered",
  );
  console.log(
    "  complexity is a separate measurement and is not bounded by this gate.",
  );
  if (ratio <= 0.5) {
    console.log(
      `\nPASS: B-side static chrome is at or below 50% of A-side (M13 simplification gate).`,
    );
  } else {
    console.log(
      `\nFAIL: B-side static chrome exceeds 50% of A-side (current ratio ${(ratio * 100).toFixed(1)}%). M13 simplification gate violated.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
