import { createWorkerId, runSyncWorker } from "@/lib/sync/runtime";

let stopRequested = false;
const workerId = createWorkerId("sync-worker");

process.on("SIGTERM", () => {
  console.log(`[sync-worker] SIGTERM received, stopping after current claim (${workerId})`);
  stopRequested = true;
});

process.on("SIGINT", () => {
  console.log(`[sync-worker] SIGINT received, stopping after current claim (${workerId})`);
  stopRequested = true;
});

async function main() {
  console.log(`[sync-worker] starting ${workerId}`);
  await runSyncWorker(workerId, {
    shouldStop: () => stopRequested,
    pollMs: 5_000,
  });
  console.log(`[sync-worker] stopped ${workerId}`);
}

main().catch((error) => {
  console.error("[sync-worker] fatal error", error);
  process.exit(1);
});
