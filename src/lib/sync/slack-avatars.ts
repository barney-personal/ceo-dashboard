import "server-only";
import { db } from "@/lib/db";
import { slackEmployeeMap } from "@/lib/db/schema";
import { getUserAvatarUrl } from "@/lib/integrations/slack";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

const STALE_AFTER_DAYS = 30;
const FETCH_CONCURRENCY = 4;

export interface SlackAvatarSyncResult {
  total: number;
  fetched: number;
  unchanged: number;
  failed: number;
}

/**
 * Refresh `slack_employee_map.slack_image_url` for every Slack user that
 * resolves to an employee. Called from the GitHub-mapping admin page so the
 * CEO can refresh on demand — there's no cron behind this. Re-fetching is
 * cheap (Slack's `users.info` is tier-4, 100 req/min) so we update anything
 * that's stale or missing rather than diffing.
 *
 * `force` ignores the staleness check and re-fetches every row.
 */
export async function syncSlackAvatars(
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<SlackAvatarSyncResult> {
  const cutoff = new Date(
    Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = await db
    .select({
      slackUserId: slackEmployeeMap.slackUserId,
      slackImageUrl: slackEmployeeMap.slackImageUrl,
    })
    .from(slackEmployeeMap)
    .where(
      opts.force
        ? isNotNull(slackEmployeeMap.employeeEmail)
        : and(
            isNotNull(slackEmployeeMap.employeeEmail),
            or(
              isNull(slackEmployeeMap.slackImageFetchedAt),
              lt(slackEmployeeMap.slackImageFetchedAt, cutoff),
            ),
          ),
    );

  const result: SlackAvatarSyncResult = {
    total: rows.length,
    fetched: 0,
    unchanged: 0,
    failed: 0,
  };

  let cursor = 0;
  const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= rows.length) return;
      const row = rows[i];
      const url = await getUserAvatarUrl(row.slackUserId, {
        signal: opts.signal,
      });
      if (url === null) {
        // Don't advance fetched_at on failure: a transient Slack outage
        // would otherwise lock the affected rows out of the next 30 days
        // of refreshes. The cost is one extra users.info call per failing
        // user per refresh, which is bounded by Slack's tier-4 limit and
        // only paid when the CEO clicks "Refresh".
        result.failed++;
        continue;
      }
      if (url === row.slackImageUrl) {
        await db
          .update(slackEmployeeMap)
          .set({ slackImageFetchedAt: sql`now()` })
          .where(eq(slackEmployeeMap.slackUserId, row.slackUserId));
        result.unchanged++;
        continue;
      }
      await db
        .update(slackEmployeeMap)
        .set({ slackImageUrl: url, slackImageFetchedAt: sql`now()` })
        .where(eq(slackEmployeeMap.slackUserId, row.slackUserId));
      result.fetched++;
    }
  });

  await Promise.all(workers);
  return result;
}
