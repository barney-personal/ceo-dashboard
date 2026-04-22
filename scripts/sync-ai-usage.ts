// One-off: enqueue + run a single Mode sync scoped to the AI Model Usage
// Dashboard so the new page has data to display without waiting for cron
// or logging into the UI as CEO.
//
// Usage: doppler run -- npx tsx scripts/sync-ai-usage.ts
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { createWorkerId, runSyncWorker } from "@/lib/sync/runtime";

const AI_USAGE_REPORT_TOKEN = "ac8032a3cc89";

async function main() {
  console.log("[sync-ai-usage] enqueueing mode run for AI Model Usage Dashboard");
  const result = await enqueueSyncRun("mode", {
    trigger: "manual",
    force: true,
    scope: { reportToken: AI_USAGE_REPORT_TOKEN },
  });
  console.log("[sync-ai-usage] enqueue result:", result);

  const workerId = createWorkerId("sync-ai-usage");
  let stopRequested = false;

  const finishedStates = new Set([
    "success",
    "partial",
    "error",
    "cancelled",
  ]);

  // Poll the DB after each claim attempt so we can stop as soon as the run
  // we enqueued has finished.
  const { db } = await import("@/lib/db");
  const { syncLog } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const targetRunId = result.runId;

  const poll = setInterval(async () => {
    if (!targetRunId) return;
    const [row] = await db
      .select({ status: syncLog.status })
      .from(syncLog)
      .where(eq(syncLog.id, targetRunId))
      .limit(1);
    if (row && finishedStates.has(row.status)) {
      console.log(
        `[sync-ai-usage] run ${targetRunId} finished with status ${row.status}`,
      );
      stopRequested = true;
    }
  }, 1_000);

  try {
    await runSyncWorker(workerId, {
      shouldStop: () => stopRequested,
      pollMs: 500,
    });
  } finally {
    clearInterval(poll);
  }

  console.log("[sync-ai-usage] done");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[sync-ai-usage] fatal", error);
    process.exit(1);
  });
