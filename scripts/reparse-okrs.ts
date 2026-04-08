/**
 * One-off script: clear OKR data and re-sync with the new model.
 * Usage: npx tsx scripts/reparse-okrs.ts
 */
import { db } from "@/lib/db";
import { okrUpdates, syncLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { claimQueuedSyncRun, enqueueSyncRun } from "@/lib/sync/coordinator";
import { createWorkerId, runClaimedSync } from "@/lib/sync/runtime";

async function main() {
  console.log("Clearing existing OKR updates...");
  const deleted = await db.delete(okrUpdates).returning({ id: okrUpdates.id });
  console.log(`  Deleted ${deleted.length} rows from okr_updates`);

  console.log("Clearing Slack sync log entries...");
  const deletedLogs = await db
    .delete(syncLog)
    .where(eq(syncLog.source, "slack"))
    .returning({ id: syncLog.id });
  console.log(`  Deleted ${deletedLogs.length} rows from sync_log`);

  console.log("\nRunning full OKR sync with claude-sonnet-4-6...");
  const workerId = createWorkerId("script");
  await enqueueSyncRun("slack", { trigger: "manual", force: true });
  const claimed = await claimQueuedSyncRun(workerId, "slack");
  if (!claimed) {
    throw new Error("Unable to claim queued Slack sync");
  }
  const result = await runClaimedSync(claimed);

  console.log(`\nDone!`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Records synced: ${result.recordsSynced}`);
  if (result.errors.length > 0) {
    console.log(`  Errors:`);
    result.errors.forEach((error: string) => console.log(`    - ${error}`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
