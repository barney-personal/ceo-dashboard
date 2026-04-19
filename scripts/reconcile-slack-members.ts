/**
 * Match Slack member accounts to SSoT employees, writing results to slack_employee_map.
 *
 * Strategy (in order, first-match wins):
 *   1. Slack username (lowercased) == SSoT email local-part → `auto_username`
 *   2. Slack name (normalised) == SSoT preferred_name (normalised) → `auto_name`
 *   3. Slack username ends in `_ext` → `external`
 *   4. Otherwise → `unmatched`
 *
 * Manual overrides (match_method='manual') are left untouched. A row with an
 * explicit manual mapping always wins.
 *
 * Usage:
 *   doppler run -- npx tsx scripts/reconcile-slack-members.ts
 *   doppler run -- npx tsx scripts/reconcile-slack-members.ts --dry-run
 */
import { parseArgs } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  modeReportData,
  modeReports,
  slackEmployeeMap,
  slackMemberSnapshots,
} from "@/lib/db/schema";

type MatchMethod =
  | "auto_username"
  | "auto_name"
  | "manual"
  | "external"
  | "unmatched";

interface Ssot {
  email: string;
  local: string;
  preferred: string;
}

function normaliseName(raw: string | null | undefined): string {
  if (!raw) return "";
  // Strip emoji / non-letter marks, collapse whitespace, lowercase.
  // U+1F300-U+1FAFF covers most emoji; also strip common decorative chars.
  return raw
    .normalize("NFKD")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[|•·,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function loadSsot(): Promise<Ssot[]> {
  const rows = await db
    .select({ data: modeReportData.data })
    .from(modeReportData)
    .innerJoin(modeReports, eq(modeReports.id, modeReportData.reportId))
    .where(
      and(
        eq(modeReports.name, "Headcount SSoT Dashboard"),
        eq(modeReportData.queryName, "headcount"),
      ),
    )
    .orderBy(desc(modeReportData.syncedAt))
    .limit(1);

  if (!rows[0]) {
    throw new Error(
      "No Headcount SSoT data in mode_report_data. Sync Mode first.",
    );
  }
  const data = rows[0].data as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const out: Ssot[] = [];
  for (const r of data) {
    if (r.termination_date) continue;
    const email = String(r.email ?? "").toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    const local = email.split("@")[0]!;
    const preferred = normaliseName(r.preferred_name as string | null);
    out.push({ email, local, preferred });
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
  });
  const dryRun = values["dry-run"] ?? false;

  console.log("Loading SSoT employees…");
  const ssot = await loadSsot();
  const byLocal = new Map<string, Ssot>();
  const byPreferred = new Map<string, Ssot>();
  for (const e of ssot) {
    if (!byLocal.has(e.local)) byLocal.set(e.local, e);
    if (e.preferred && !byPreferred.has(e.preferred)) byPreferred.set(e.preferred, e);
  }
  console.log(`  ${ssot.length} active employees`);

  console.log("Loading Slack members (latest snapshot)…");
  const latestWindow = await db
    .select({
      windowStart: slackMemberSnapshots.windowStart,
      windowEnd: slackMemberSnapshots.windowEnd,
    })
    .from(slackMemberSnapshots)
    .orderBy(
      desc(slackMemberSnapshots.windowEnd),
      desc(slackMemberSnapshots.windowStart),
    )
    .limit(1);
  if (!latestWindow[0]) {
    throw new Error("No slack_member_snapshots rows. Import a CSV first.");
  }
  const slackRows = await db
    .select({
      slackUserId: slackMemberSnapshots.slackUserId,
      name: slackMemberSnapshots.name,
      username: slackMemberSnapshots.username,
    })
    .from(slackMemberSnapshots)
    .where(
      and(
        eq(slackMemberSnapshots.windowStart, latestWindow[0].windowStart),
        eq(slackMemberSnapshots.windowEnd, latestWindow[0].windowEnd),
      ),
    );
  console.log(`  ${slackRows.length} Slack members`);

  console.log("Loading existing mappings…");
  const existing = await db
    .select({
      slackUserId: slackEmployeeMap.slackUserId,
      matchMethod: slackEmployeeMap.matchMethod,
    })
    .from(slackEmployeeMap);
  const manualIds = new Set(
    existing.filter((e) => e.matchMethod === "manual").map((e) => e.slackUserId),
  );
  console.log(
    `  ${existing.length} existing mappings (${manualIds.size} manual, will preserve)`,
  );

  const counts: Record<MatchMethod, number> = {
    auto_username: 0,
    auto_name: 0,
    manual: 0,
    external: 0,
    unmatched: 0,
  };
  const updates: Array<{
    slackUserId: string;
    slackUsername: string | null;
    slackName: string | null;
    employeeEmail: string | null;
    employeeName: string | null;
    matchMethod: MatchMethod;
    note: string | null;
  }> = [];

  for (const s of slackRows) {
    if (manualIds.has(s.slackUserId)) {
      counts.manual++;
      continue; // never overwrite a manual mapping
    }
    const username = (s.username ?? "").toLowerCase().trim();
    const name = normaliseName(s.name);

    let method: MatchMethod = "unmatched";
    let match: Ssot | null = null;
    let note: string | null = null;

    if (username && byLocal.has(username)) {
      match = byLocal.get(username)!;
      method = "auto_username";
    } else if (name && byPreferred.has(name)) {
      match = byPreferred.get(name)!;
      method = "auto_name";
    } else if (username.endsWith("_ext")) {
      method = "external";
      note = "external collaborator (username ends with _ext)";
    } else {
      method = "unmatched";
    }

    counts[method]++;
    updates.push({
      slackUserId: s.slackUserId,
      slackUsername: s.username,
      slackName: s.name,
      employeeEmail: match?.email ?? null,
      employeeName: null, // we only carry email; name comes from SSoT at read time
      matchMethod: method,
      note,
    });
  }

  console.log("\nMatch summary:");
  for (const m of [
    "auto_username",
    "auto_name",
    "external",
    "unmatched",
    "manual",
  ] as const) {
    console.log(`  ${m.padEnd(14)} ${counts[m]}`);
  }
  console.log(`  total          ${slackRows.length}`);

  if (dryRun) {
    console.log("\n--dry-run: no DB writes.");
    const sample = updates
      .filter((u) => u.matchMethod === "unmatched")
      .slice(0, 20);
    if (sample.length) {
      console.log("\nSample unmatched:");
      for (const u of sample) {
        console.log(`  ${u.slackUserId}  ${u.slackUsername}  ${u.slackName}`);
      }
    }
    process.exit(0);
  }

  console.log("\nUpserting…");
  // Batch upserts; onConflict uses the unique index on slack_user_id.
  const batchSize = 200;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await db
      .insert(slackEmployeeMap)
      .values(chunk)
      .onConflictDoUpdate({
        target: slackEmployeeMap.slackUserId,
        set: {
          slackUsername: sql`excluded.slack_username`,
          slackName: sql`excluded.slack_name`,
          employeeEmail: sql`excluded.employee_email`,
          employeeName: sql`excluded.employee_name`,
          matchMethod: sql`excluded.match_method`,
          note: sql`excluded.note`,
          updatedAt: sql`now()`,
        },
      });
  }
  console.log(`  wrote ${updates.length} rows.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
