import { desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbErrorContext } from "@/lib/db/errors";
import { syncLog } from "@/lib/db/schema";

export async function getRecentSyncRuns(limit: number) {
  return withDbErrorContext("load recent sync runs", () =>
    db
      .select()
      .from(syncLog)
      .orderBy(desc(syncLog.startedAt))
      .limit(limit)
  );
}
