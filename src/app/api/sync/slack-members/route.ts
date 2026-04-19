import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncLog } from "@/lib/db/schema";
import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import {
  importSnapshot,
  SlackCsvError,
} from "@/lib/data/slack-members-import";

/** Accept up to ~5MB to comfortably fit a year-sized CSV (current 1y file is ~150KB). */
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const access = await authorizeSyncRequest(request);
  const accessError = syncRequestAccessErrorResponse(access);
  if (accessError) {
    return accessError;
  }
  const trigger = access === "cron" ? "cron" : "manual";

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing "file" field in form data' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json(
      { error: "filename must end in .csv" },
      { status: 400 },
    );
  }

  // Record an in-progress run so it appears in sync history — then finalise
  // with success or error. A NOT-NULL-constrained row is fine because we
  // always update it below (success or catch).
  const [logRow] = await db
    .insert(syncLog)
    .values({
      source: "slack-members",
      trigger,
      status: "running",
    })
    .returning({ id: syncLog.id });

  try {
    const text = await file.text();
    const result = await importSnapshot({ csvText: text, filename: file.name });

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: sql`now()`,
        recordsSynced: result.rowsInserted + result.rowsUpdated,
        scope: {
          filename: file.name,
          windowStart: result.windowStart.toISOString(),
          windowEnd: result.windowEnd.toISOString(),
          rowsParsed: result.rowsParsed,
          rowsInserted: result.rowsInserted,
          rowsUpdated: result.rowsUpdated,
          reconcile: result.reconcile,
        },
      })
      .where(sql`${syncLog.id} = ${logRow!.id}`);

    return NextResponse.json({
      ok: true,
      windowStart: result.windowStart.toISOString(),
      windowEnd: result.windowEnd.toISOString(),
      rowsParsed: result.rowsParsed,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      reconcile: result.reconcile,
    });
  } catch (err) {
    const message =
      err instanceof SlackCsvError
        ? err.message
        : err instanceof Error
          ? err.message
          : "import failed";
    const status = err instanceof SlackCsvError ? 400 : 500;
    await db
      .update(syncLog)
      .set({
        status: "error",
        completedAt: sql`now()`,
        errorMessage: message.slice(0, 500),
        scope: { filename: file.name },
      })
      .where(sql`${syncLog.id} = ${logRow!.id}`);
    return NextResponse.json({ error: message }, { status });
  }
}
