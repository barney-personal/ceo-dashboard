/**
 * Count engineering surface interactive elements (M13 acceptance).
 *
 * Crawls the A-side and B-side code paths and tallies interactive elements
 * (buttons, links, tabs, filters, toggles, row expanders, form controls) so
 * we can defend the "B-side ≤ 50% of A-side" simplification gate.
 *
 * Usage: npx tsx scripts/count-engineering-interactives.ts
 *
 * The count is deliberately heuristic — it greps for occurrences of element
 * shapes in JSX text. False positives in shared UI primitives are bounded by
 * counting only files inside the engineering surface (route or component
 * dedicated to that surface). The script prints both the per-file breakdown
 * and the aggregate ratio.
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
  byFile: Array<{ file: string; total: number; byBucket: Record<string, number> }>;
}

function emptyByBucket(): Record<string, number> {
  return Object.fromEntries(BUCKETS.map((b) => [b.label, 0]));
}

function countFile(file: string): { total: number; byBucket: Record<string, number> } {
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
  return { total, byBucket };
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
  const byBucket = emptyByBucket();
  const byFile: Counts["byFile"] = [];

  for (const file of sortedFiles) {
    const counts = countFile(file);
    if (counts.total === 0) continue;
    total.value += counts.total;
    for (const [k, v] of Object.entries(counts.byBucket)) byBucket[k] += v;
    byFile.push({
      file: relative(ROOT, file),
      total: counts.total,
      byBucket: counts.byBucket,
    });
  }

  console.log(`\n=== ${label} ===`);
  console.log(`Total interactive elements: ${total.value}`);
  console.log("By category:");
  for (const [k, v] of Object.entries(byBucket)) {
    console.log(`  ${k.padEnd(36)} ${v}`);
  }
  console.log("\nTop 10 files by interactive count:");
  for (const entry of byFile.slice(0).sort((a, b) => b.total - a.total).slice(0, 10)) {
    console.log(`  ${entry.total.toString().padStart(4)}  ${entry.file}`);
  }

  return { total: total.value, byBucket, byFile };
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

  console.log("\n=== Aggregate ===");
  console.log(`A-side: ${aSide.total}`);
  console.log(`B-side: ${bSide.total}`);
  console.log(`Ratio (B / A): ${(ratio * 100).toFixed(1)}%`);
  if (ratio <= 0.5) {
    console.log(
      `\nPASS: B-side is at or below 50% of A-side interactive elements (M13 simplification gate).`,
    );
  } else {
    console.log(
      `\nFAIL: B-side exceeds 50% of A-side (current ratio ${(ratio * 100).toFixed(1)}%). M13 simplification gate violated.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
