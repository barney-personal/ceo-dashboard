#!/usr/bin/env tsx
/**
 * Preview daily briefings for specific staff — dev-only tool.
 *
 * Usage:
 *   doppler run -- tsx scripts/preview-briefings.ts email1@meetcleo.com email2@...
 *   doppler run -- tsx scripts/preview-briefings.ts --per-pillar        # one per pillar
 *   doppler run -- tsx scripts/preview-briefings.ts --list-pillars       # show pillar → people
 *
 * Always bypasses the DB cache so you see a fresh generation. Role defaults
 * to "everyone" unless --role=ceo|leadership|manager is passed.
 */

import type { Role } from "@/lib/auth/roles";
import { getActiveEmployees, type Person } from "@/lib/data/people";
import { getBriefingContext } from "@/lib/data/briefing-context";
import { generateBriefing } from "@/lib/integrations/llm-briefing";

interface Args {
  emails: string[];
  perPillar: boolean;
  listPillars: boolean;
  role: Role;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    emails: [],
    perPillar: false,
    listPillars: false,
    role: "everyone",
  };
  for (const a of argv) {
    if (a === "--per-pillar") args.perPillar = true;
    else if (a === "--list-pillars") args.listPillars = true;
    else if (a.startsWith("--role=")) args.role = a.slice("--role=".length) as Role;
    else if (a.includes("@")) args.emails.push(a.toLowerCase());
  }
  return args;
}

function groupByPillar(people: Person[]): Map<string, Person[]> {
  const map = new Map<string, Person[]>();
  for (const p of people) {
    const existing = map.get(p.pillar) ?? [];
    existing.push(p);
    map.set(p.pillar, existing);
  }
  return map;
}

async function previewOne(email: string, role: Role): Promise<void> {
  const start = Date.now();
  console.log(`\n${"=".repeat(72)}`);
  console.log(`▸ ${email}  (role=${role})`);
  console.log("=".repeat(72));

  const context = await getBriefingContext({ emails: [email], role });
  if (!context.person) {
    console.log("  (not found in Headcount SSoT — skipping)");
    return;
  }

  const p = context.person;
  console.log(
    `  ${p.fullName} — ${p.jobTitle}\n` +
      `  ${p.squad} / ${p.pillar} / ${p.function} · tenure ${p.tenureMonths}mo · ${p.directReportCount} direct reports`,
  );

  const sokr = context.squadOkrs;
  const pokr = context.pillarOkrs;
  console.log(
    `  Squad OKRs:  ${sokr.total} total — ${sokr.onTrack} on-track / ${sokr.atRisk} at-risk / ${sokr.behind} behind / ${sokr.notStarted} not-started`,
  );
  console.log(
    `  Pillar OKRs: ${pokr.total} total — ${pokr.onTrack} on-track / ${pokr.atRisk} at-risk / ${pokr.behind} behind / ${pokr.notStarted} not-started`,
  );
  if (context.meetings) {
    console.log(
      `  Meetings today: ${context.meetings.todayCount}${context.meetings.firstTitle ? ` · next: "${context.meetings.firstTitle}"` : ""}`,
    );
  }
  console.log(
    `  Sections: ${context.relevantDashboardSections.join(", ")}`,
  );

  const result = await generateBriefing(context);
  const elapsedMs = Date.now() - start;
  console.log(
    `\n  ── briefing (${elapsedMs}ms, in=${result.usage.inputTokens} out=${result.usage.outputTokens} cache_read=${result.usage.cacheReadTokens} cache_write=${result.usage.cacheCreationTokens}) ──\n`,
  );
  for (const line of result.text.split("\n")) console.log(`  ${line}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const data = await getActiveEmployees();
  const allEmployees = [...data.employees, ...data.unassigned];
  const byPillar = groupByPillar(data.employees);

  if (args.listPillars) {
    console.log("Pillars and sample people:");
    for (const [pillar, people] of byPillar.entries()) {
      console.log(`\n  ${pillar}  (${people.length} people)`);
      for (const p of people.slice(0, 3)) {
        console.log(`    ${p.email.padEnd(40)} ${p.name} — ${p.squad}`);
      }
    }
    return;
  }

  let targets: string[] = args.emails;
  if (args.perPillar && targets.length === 0) {
    // One person per pillar — pick the one with the shortest email so the
    // output is tidy, deterministic, and easy to re-run.
    targets = [...byPillar.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, people]) => {
        const sorted = [...people].sort((a, b) => a.email.length - b.email.length);
        return sorted[0]?.email ?? "";
      })
      .filter((e) => e);
  }

  if (targets.length === 0) {
    console.error(
      "Pass one or more emails, or --per-pillar, or --list-pillars. Run with --help for usage.",
    );
    process.exit(1);
  }

  // Validate emails exist in SSoT before burning LLM calls.
  const known = new Set(allEmployees.map((p) => p.email.toLowerCase()));
  const missing = targets.filter((e) => !known.has(e));
  if (missing.length > 0) {
    console.warn(
      `⚠︎  Not in Headcount SSoT (will be skipped): ${missing.join(", ")}`,
    );
  }

  for (const email of targets) {
    try {
      await previewOne(email, args.role);
    } catch (err) {
      console.error(`\n  ✘ ${email} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
