/**
 * End-to-end test of the shared import library: clear existing data, import
 * the CSV from a known local file, verify counts match expectations.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  slackEmployeeMap,
  slackMemberSnapshots,
  syncLog,
} from "@/lib/db/schema";
import {
  importSnapshot,
  parseWindowFromFilename,
  SlackCsvError,
} from "@/lib/data/slack-members-import";
import { getSlackSyncStatus } from "@/lib/data/slack-members-sync-status";

async function main() {
  const filepath = "/tmp/slack-analytics/cleo_members_1y.csv";
  const filename = "Cleo Member Analytics Mar 17, 2025 - Apr 17, 2026.csv";

  // Filename parse test — should round-trip
  const win = parseWindowFromFilename(filename);
  console.log(
    `Parsed window: ${win.windowStart.toISOString().slice(0, 10)} → ${win.windowEnd.toISOString().slice(0, 10)}`,
  );
  // Also test the "prior N days" variant
  const priorWin = parseWindowFromFilename(
    "Cleo Member Analytics Prior 30 Days - Apr 17, 2026.csv",
  );
  console.log(
    `"Prior 30 Days" → ${priorWin.windowStart.toISOString().slice(0, 10)} → ${priorWin.windowEnd.toISOString().slice(0, 10)}`,
  );

  // Expected failure — bad filename
  try {
    parseWindowFromFilename("random.csv");
    throw new Error("should have thrown");
  } catch (e) {
    if (!(e instanceof SlackCsvError) || e.kind !== "filename") {
      throw e;
    }
    console.log(`Bad filename correctly rejected.`);
  }

  console.log("\nClearing existing data…");
  await db.delete(slackEmployeeMap);
  await db.delete(slackMemberSnapshots);
  await db.delete(syncLog).where(sql`source = 'slack-members'`);

  console.log("Importing CSV via shared lib…");
  const csvText = readFileSync(filepath, "utf8");
  const result = await importSnapshot({ csvText, filename });
  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.rowsInserted !== 850) {
    throw new Error(`Expected 850 inserts, got ${result.rowsInserted}`);
  }
  // Re-import should upsert: 0 inserts, 850 updates.
  console.log("\nRe-running to confirm upsert semantics…");
  const second = await importSnapshot({ csvText, filename });
  if (second.rowsInserted !== 0 || second.rowsUpdated !== 850) {
    throw new Error(
      `Expected 0 inserts + 850 updates on second run, got ${second.rowsInserted}/${second.rowsUpdated}`,
    );
  }
  console.log(`  inserted=${second.rowsInserted} updated=${second.rowsUpdated} ✓`);

  // Corrected re-export: modify one field in memory and verify it lands
  console.log("\nSimulating a corrected re-export (mutate one row)…");
  const corrected = csvText.replace(
    /Aaron,"Programmatic Marketing Manager",U0AESCBQVP1,aaron.p,Member,/,
    'Aaron,"[Corrected] Programmatic Marketing Manager",U0AESCBQVP1,aaron.p,Member,',
  );
  if (corrected === csvText) throw new Error("Failed to seed correction");
  const third = await importSnapshot({ csvText: corrected, filename });
  console.log(`  inserted=${third.rowsInserted} updated=${third.rowsUpdated}`);
  const [aaron] = await db.execute<{ title: string }>(sql`
    SELECT title FROM slack_member_snapshots
    WHERE slack_user_id = 'U0AESCBQVP1' AND window_start = ${win.windowStart.toISOString()}
  `);
  console.log(`  Aaron's stored title: "${aaron?.title}"`);
  if (!aaron?.title?.startsWith("[Corrected]")) {
    throw new Error("Correction did not land on the existing row");
  }
  console.log("  ✓ corrected values overwrote the old snapshot row");

  // Re-apply manual overrides we set up earlier for the 10 unmatched employees
  console.log("\nRe-applying manual overrides…");
  const overrides: Array<{ id: string; email: string | null; method: string; note: string }> = [
    { id: "U339CS7PW", email: "michael@meetcleo.com", method: "manual", note: "legacy handle: mijoharas" },
    { id: "U9QD86AGG", email: "cassie@meetcleo.com", method: "manual", note: "Slack display uses Cassie not Cassiopeia" },
    { id: "UEWDZ0Q1J", email: "gus@meetcleo.com", method: "manual", note: "Slack uses full Semiao-Lobo" },
    { id: "U04T21GDZPX", email: "rebecca@meetcleo.com", method: "manual", note: "SSoT preferred_name Becks Jones" },
    { id: "U064F0079T8", email: "jess.m@meetcleo.com", method: "manual", note: "SSoT full name Jessica" },
    { id: "U094F099FML", email: "tomek.w@meetcleo.com", method: "manual", note: "tomekwszelaki -> tomek.w" },
    { id: "U09UWSZCZ0C", email: "adam.j@meetcleo.com", method: "manual", note: "Slack display name just Adam" },
    { id: "U0AHVRA8X50", email: "amin.a@meetcleo.com", method: "manual", note: "Slack username amin only" },
    { id: "U07JVFGJ9EX", email: null, method: "external", note: "contractor - not in HiBob SSoT" },
    { id: "U0ATB6CAA68", email: null, method: "external", note: "test account" },
  ];
  for (const o of overrides) {
    await db.execute(sql`
      UPDATE slack_employee_map
      SET employee_email = ${o.email},
          match_method = ${o.method},
          note = ${o.note},
          updated_at = now()
      WHERE slack_user_id = ${o.id}
    `);
  }
  console.log(`  Re-applied ${overrides.length} overrides.`);

  // Status check
  const status = await getSlackSyncStatus();
  console.log("\nSync status:", JSON.stringify(status, null, 2));

  // Sync-log row check
  const logs = await db.execute<{ id: number; source: string; status: string; records_synced: number }>(sql`
    SELECT id, source, status, records_synced FROM sync_log
    WHERE source = 'slack-members' ORDER BY id DESC LIMIT 5
  `);
  console.log(
    `\nSync log rows for slack-members:`,
    logs.map((l) => `id=${l.id} status=${l.status} records=${l.records_synced}`),
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
