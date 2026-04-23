// Trigger a Mode sync from the CLI — uses the same runtime machinery as the
// /api/cron handler but without needing the Next.js dev server to be running.
//
// Usage: doppler run -- npx tsx scripts/trigger-mode-sync.ts

import { enqueueSyncRun } from "@/lib/sync/coordinator";
import {
  awaitDrainStarted,
  createWorkerId,
  startBackgroundSyncDrain,
} from "@/lib/sync/runtime";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timeout",
]);

async function main() {
  const result = await enqueueSyncRun("mode", { trigger: "manual" });
  console.log("enqueue result:", JSON.stringify(result, null, 2));

  if (result.runId == null) {
    console.log("No run id — sync skipped or deduped.");
    process.exit(0);
  }

  const worker = createWorkerId("cli-talent-sync");
  const { started } = startBackgroundSyncDrain(worker, {
    runIds: [result.runId],
    triggerLabel: "cli-talent-sync",
  });
  const drainState = await awaitDrainStarted(started);
  console.log("drain:", drainState);

  const runId = result.runId;
  const deadline = Date.now() + 10 * 60_000; // 10 minute safety cap
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(syncLog)
      .where(eq(syncLog.id, runId));
    if (!row) {
      console.log("run disappeared?");
      break;
    }
    if (TERMINAL_STATUSES.has(row.status)) {
      console.log(
        `[done] status=${row.status} records=${row.recordsSynced} error=${row.errorMessage ?? "-"}`,
      );
      break;
    }
    process.stdout.write(`. [${row.status}] `);
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\nfinished.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
