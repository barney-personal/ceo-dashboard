/**
 * Shared import logic for Slack Member Analytics CSV files.
 *
 * Used by both the CLI script (`scripts/import-slack-members.ts`) and the
 * web upload endpoint (`src/app/api/sync/slack-members/route.ts`). Keeping
 * the parsing + DB write logic in one place avoids drift between them.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  modeReportData,
  modeReports,
  slackEmployeeMap,
  slackMemberSnapshots,
} from "@/lib/db/schema";

const EXPECTED_HEADERS = [
  "Name",
  "What I Do",
  "User ID",
  "Username",
  "Account type",
  "Account created (UTC)",
  "Claimed Date (UTC)",
  "Deactivated date (UTC)",
  "Days active",
  "Days active (Desktop)",
  "Days active (Android)",
  "Days active (iOS)",
  "Messages posted",
  "Messages posted in channels",
  "Reactions added",
  "Last active (UTC)",
  "Last active (Desktop) (UTC)",
  "Last active (Android) (UTC)",
  "Last active (iOS) (UTC)",
];

export interface ImportResult {
  windowStart: Date;
  windowEnd: Date;
  rowsParsed: number;
  /** Newly-inserted rows — i.e. this (window, user) combination didn't exist before. */
  rowsInserted: number;
  /** Existing rows whose metric values were overwritten by this upload. */
  rowsUpdated: number;
  reconcile: ReconcileCounts;
}

export interface ReconcileCounts {
  auto_username: number;
  auto_name: number;
  manual: number;
  external: number;
  unmatched: number;
}

export class SlackCsvError extends Error {
  constructor(
    message: string,
    readonly kind: "filename" | "header" | "data",
  ) {
    super(message);
    this.name = "SlackCsvError";
  }
}

/**
 * Parse the window covered by a Slack Member Analytics CSV from its filename.
 * Slack uses two formats:
 *   "Cleo Member Analytics Prior 30 Days - Apr 17, 2026.csv"
 *   "Cleo Member Analytics Mar 17, 2025 - Apr 17, 2026.csv"
 * Throws SlackCsvError('filename') when neither matches.
 */
export function parseWindowFromFilename(
  filename: string,
): { windowStart: Date; windowEnd: Date } {
  const priorMatch = filename.match(
    /Prior\s+(\d+)\s+Days?\s+-\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
  );
  if (priorMatch) {
    const days = Number(priorMatch[1]);
    const end = parseHumanDate(priorMatch[2]!);
    const start = new Date(end.getTime() - days * 86_400_000);
    return { windowStart: start, windowEnd: end };
  }
  const rangeMatch = filename.match(
    /([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})\s+-\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
  );
  if (rangeMatch) {
    return {
      windowStart: parseHumanDate(rangeMatch[1]!),
      windowEnd: parseHumanDate(rangeMatch[2]!),
    };
  }
  throw new SlackCsvError(
    `Cannot derive window from filename "${filename}". Expected "… Prior N Days - Mmm D, YYYY.csv" or "… Mmm D, YYYY - Mmm D, YYYY.csv".`,
    "filename",
  );
}

function parseHumanDate(value: string): Date {
  const d = new Date(value.trim() + " UTC");
  if (isNaN(d.getTime())) {
    throw new SlackCsvError(`Unrecognised date: "${value}"`, "data");
  }
  return d;
}

/** Minimal CSV parser: quoted fields, escaped quotes, commas, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseSlackDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseHumanDate(trimmed);
}

function parseInteger(value: string): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new SlackCsvError(`Unrecognised integer: "${value}"`, "data");
  }
  return n;
}

/**
 * Parse + import a CSV file. Upserts on the (windowStart, windowEnd,
 * slackUserId) unique key so a corrected re-export of the same window
 * overwrites the stored metrics rather than being silently dropped.
 * Idempotent in the "same input → same final state" sense.
 *
 * After insert, runs reconciliation so new members land in
 * slack_employee_map.
 */
export async function importSnapshot(input: {
  csvText: string;
  filename: string;
}): Promise<ImportResult> {
  const { windowStart, windowEnd } = parseWindowFromFilename(input.filename);
  const parsed = parseCsv(input.csvText);
  if (parsed.length < 2) {
    throw new SlackCsvError("CSV has no data rows", "data");
  }
  const [header, ...rawRows] = parsed;

  // Validate header — catch "Slack changed their export format" early
  const missing = EXPECTED_HEADERS.filter((h) => !header!.includes(h));
  if (missing.length > 0) {
    throw new SlackCsvError(
      `CSV header missing expected columns: ${missing.join(", ")}`,
      "header",
    );
  }

  const headerIndex = new Map(header!.map((h, i) => [h, i]));
  const col = (row: string[], name: string): string => {
    const idx = headerIndex.get(name);
    return idx !== undefined ? (row[idx] ?? "") : "";
  };

  const records = rawRows.filter((r) => r.some((c) => c.trim() !== ""));
  const mapped = records.map((r) => ({
    windowStart,
    windowEnd,
    slackUserId: col(r, "User ID"),
    name: col(r, "Name") || null,
    username: col(r, "Username") || null,
    title: col(r, "What I Do") || null,
    accountType: col(r, "Account type") || null,
    accountCreatedAt: parseSlackDate(col(r, "Account created (UTC)")),
    claimedAt: parseSlackDate(col(r, "Claimed Date (UTC)")),
    deactivatedAt: parseSlackDate(col(r, "Deactivated date (UTC)")),
    daysActive: parseInteger(col(r, "Days active")),
    daysActiveDesktop: parseInteger(col(r, "Days active (Desktop)")),
    daysActiveAndroid: parseInteger(col(r, "Days active (Android)")),
    daysActiveIos: parseInteger(col(r, "Days active (iOS)")),
    messagesPosted: parseInteger(col(r, "Messages posted")),
    messagesPostedInChannels: parseInteger(
      col(r, "Messages posted in channels"),
    ),
    reactionsAdded: parseInteger(col(r, "Reactions added")),
    lastActiveAt: parseSlackDate(col(r, "Last active (UTC)")),
    lastActiveDesktopAt: parseSlackDate(col(r, "Last active (Desktop) (UTC)")),
    lastActiveAndroidAt: parseSlackDate(col(r, "Last active (Android) (UTC)")),
    lastActiveIosAt: parseSlackDate(col(r, "Last active (iOS) (UTC)")),
  }));

  // Upsert: a fresh export of the same (windowStart, windowEnd, slackUserId)
  // overwrites the stored metrics rather than being dropped. Postgres exposes
  // `xmax = 0` on the returning row when the tuple was inserted (vs updated),
  // which lets us report insert/update counts separately without a second
  // round-trip.
  const chunkSize = 500;
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const result = await db
      .insert(slackMemberSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          slackMemberSnapshots.windowStart,
          slackMemberSnapshots.windowEnd,
          slackMemberSnapshots.slackUserId,
        ],
        set: {
          name: sql`excluded.name`,
          username: sql`excluded.username`,
          title: sql`excluded.title`,
          accountType: sql`excluded.account_type`,
          accountCreatedAt: sql`excluded.account_created_at`,
          claimedAt: sql`excluded.claimed_at`,
          deactivatedAt: sql`excluded.deactivated_at`,
          daysActive: sql`excluded.days_active`,
          daysActiveDesktop: sql`excluded.days_active_desktop`,
          daysActiveAndroid: sql`excluded.days_active_android`,
          daysActiveIos: sql`excluded.days_active_ios`,
          messagesPosted: sql`excluded.messages_posted`,
          messagesPostedInChannels: sql`excluded.messages_posted_in_channels`,
          reactionsAdded: sql`excluded.reactions_added`,
          lastActiveAt: sql`excluded.last_active_at`,
          lastActiveDesktopAt: sql`excluded.last_active_desktop_at`,
          lastActiveAndroidAt: sql`excluded.last_active_android_at`,
          lastActiveIosAt: sql`excluded.last_active_ios_at`,
          importedAt: sql`now()`,
        },
      })
      .returning({
        id: slackMemberSnapshots.id,
        inserted: sql<boolean>`(xmax = 0)`,
      });
    for (const row of result) {
      if (row.inserted) inserted++;
      else updated++;
    }
  }

  const reconcile = await reconcileMap({ windowStart, windowEnd });

  return {
    windowStart,
    windowEnd,
    rowsParsed: mapped.length,
    rowsInserted: inserted,
    rowsUpdated: updated,
    reconcile,
  };
}

function normaliseName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKD")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[|•·,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Run auto-match against the latest (or passed) snapshot window. Preserves any
 *  existing rows with match_method='manual'. */
export async function reconcileMap(opts?: {
  windowStart?: Date;
  windowEnd?: Date;
}): Promise<ReconcileCounts> {
  // Load SSoT
  const ssotRows = await db
    .select({ data: modeReportData.data })
    .from(modeReportData)
    .innerJoin(modeReports, eq(modeReports.id, modeReportData.reportId))
    .where(
      and(
        eq(modeReports.name, "Headcount SSoT Dashboard"),
        eq(modeReportData.queryName, "headcount"),
      ),
    )
    .orderBy(desc(modeReportData.syncedAt))
    .limit(1);
  const ssot = (ssotRows[0]?.data ?? []) as Array<Record<string, unknown>>;

  const byLocal = new Map<string, { email: string }>();
  const byPreferred = new Map<string, { email: string }>();
  for (const r of ssot) {
    if (r.termination_date) continue;
    const email = String(r.email ?? "").toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    const local = email.split("@")[0]!;
    if (!byLocal.has(local)) byLocal.set(local, { email });
    const preferred = normaliseName(r.preferred_name as string | null);
    if (preferred && !byPreferred.has(preferred))
      byPreferred.set(preferred, { email });
  }

  // Resolve window (latest if not provided)
  let windowStart = opts?.windowStart;
  let windowEnd = opts?.windowEnd;
  if (!windowStart || !windowEnd) {
    const [latest] = await db
      .select({
        windowStart: slackMemberSnapshots.windowStart,
        windowEnd: slackMemberSnapshots.windowEnd,
      })
      .from(slackMemberSnapshots)
      .orderBy(
        desc(slackMemberSnapshots.windowEnd),
        desc(slackMemberSnapshots.windowStart),
      )
      .limit(1);
    if (!latest) {
      return { auto_username: 0, auto_name: 0, manual: 0, external: 0, unmatched: 0 };
    }
    windowStart = latest.windowStart;
    windowEnd = latest.windowEnd;
  }

  const slackRows = await db
    .select({
      slackUserId: slackMemberSnapshots.slackUserId,
      name: slackMemberSnapshots.name,
      username: slackMemberSnapshots.username,
    })
    .from(slackMemberSnapshots)
    .where(
      and(
        eq(slackMemberSnapshots.windowStart, windowStart),
        eq(slackMemberSnapshots.windowEnd, windowEnd),
      ),
    );

  const existing = await db
    .select({
      slackUserId: slackEmployeeMap.slackUserId,
      matchMethod: slackEmployeeMap.matchMethod,
    })
    .from(slackEmployeeMap);
  const manualIds = new Set(
    existing
      .filter((e) => e.matchMethod === "manual")
      .map((e) => e.slackUserId),
  );

  const counts: ReconcileCounts = {
    auto_username: 0,
    auto_name: 0,
    manual: 0,
    external: 0,
    unmatched: 0,
  };

  const updates: Array<{
    slackUserId: string;
    slackUsername: string | null;
    slackName: string | null;
    employeeEmail: string | null;
    employeeName: string | null;
    matchMethod: string;
    note: string | null;
  }> = [];

  for (const s of slackRows) {
    if (manualIds.has(s.slackUserId)) {
      counts.manual++;
      continue;
    }
    const username = (s.username ?? "").toLowerCase().trim();
    const name = normaliseName(s.name);

    let method: keyof ReconcileCounts = "unmatched";
    let email: string | null = null;
    let note: string | null = null;

    if (username && byLocal.has(username)) {
      email = byLocal.get(username)!.email;
      method = "auto_username";
    } else if (name && byPreferred.has(name)) {
      email = byPreferred.get(name)!.email;
      method = "auto_name";
    } else if (username.endsWith("_ext")) {
      method = "external";
      note = "external collaborator (username ends with _ext)";
    }

    counts[method]++;
    updates.push({
      slackUserId: s.slackUserId,
      slackUsername: s.username,
      slackName: s.name,
      employeeEmail: email,
      employeeName: null,
      matchMethod: method,
      note,
    });
  }

  const batchSize = 200;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await db
      .insert(slackEmployeeMap)
      .values(chunk)
      .onConflictDoUpdate({
        target: slackEmployeeMap.slackUserId,
        set: {
          slackUsername: sql`excluded.slack_username`,
          slackName: sql`excluded.slack_name`,
          employeeEmail: sql`excluded.employee_email`,
          employeeName: sql`excluded.employee_name`,
          matchMethod: sql`excluded.match_method`,
          note: sql`excluded.note`,
          updatedAt: sql`now()`,
        },
      });
  }

  return counts;
}
