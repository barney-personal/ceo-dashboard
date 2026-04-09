import { db } from "@/lib/db";
import { debugLogs } from "@/lib/db/schema";

export async function debugLog(
  source: string,
  event: string,
  data?: Record<string, unknown>,
  opts?: { level?: string; syncRunId?: number }
) {
  try {
    await db.insert(debugLogs).values({
      source,
      event,
      level: opts?.level ?? "info",
      data: data ?? null,
      syncRunId: opts?.syncRunId ?? null,
    });
  } catch {
    // Never let debug logging break the sync
    console.error("Failed to write debug log", { source, event });
  }
}

// Auto-cleanup: delete logs older than 24 hours
export async function cleanupDebugLogs() {
  await db.execute(
    `DELETE FROM debug_logs WHERE created_at < NOW() - INTERVAL '24 hours'`
  );
}
