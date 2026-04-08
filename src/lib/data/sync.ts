import { desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";

export async function getRecentSyncRuns(limit: number) {
  return db
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.startedAt))
    .limit(limit);
}
