/**
 * Import a Slack "Member Analytics" CSV into slack_member_snapshots.
 *
 * Usage:
 *   doppler run -- npx tsx scripts/import-slack-members.ts \
 *     --file /tmp/slack-analytics/cleo_members_1y.csv \
 *     --start 2025-03-17 --end 2026-04-17
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { db } from "@/lib/db";
import { slackMemberSnapshots } from "@/lib/db/schema";

interface Row {
  Name: string;
  "What I Do": string;
  "User ID": string;
  Username: string;
  "Account type": string;
  "Account created (UTC)": string;
  "Claimed Date (UTC)": string;
  "Deactivated date (UTC)": string;
  "Days active": string;
  "Days active (Desktop)": string;
  "Days active (Android)": string;
  "Days active (iOS)": string;
  "Messages posted": string;
  "Messages posted in channels": string;
  "Reactions added": string;
  "Last active (UTC)": string;
  "Last active (Desktop) (UTC)": string;
  "Last active (Android) (UTC)": string;
  "Last active (iOS) (UTC)": string;
}

// Minimal CSV parser: handles quoted fields, escaped quotes, commas, newlines in quotes.
function parseCsv(text: string): string[][] {
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
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
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
  // Slack emits dates like "Feb 16, 2026" (UTC). Date parses this as local time,
  // so we reconstruct it explicitly as midnight UTC.
  const d = new Date(trimmed + " UTC");
  if (isNaN(d.getTime())) {
    throw new Error(`Unrecognised date: ${trimmed}`);
  }
  return d;
}

function parseInteger(value: string): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`Unrecognised integer: ${value}`);
  }
  return n;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    },
  });

  if (!values.file || !values.start || !values.end) {
    console.error(
      "Usage: --file <path.csv> --start <YYYY-MM-DD> --end <YYYY-MM-DD>"
    );
    process.exit(1);
  }

  const windowStart = new Date(`${values.start}T00:00:00Z`);
  const windowEnd = new Date(`${values.end}T00:00:00Z`);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new Error("Invalid --start or --end (expected YYYY-MM-DD)");
  }

  const text = readFileSync(values.file, "utf8");
  const parsed = parseCsv(text);
  if (parsed.length < 2) {
    throw new Error("CSV has no data rows");
  }
  const [header, ...rows] = parsed;
  const records: Row[] = rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      header!.forEach((h, i) => {
        obj[h] = r[i] ?? "";
      });
      return obj as unknown as Row;
    });

  console.log(
    `Parsed ${records.length} rows from ${values.file}. Window: ${values.start} → ${values.end}`
  );

  const mapped = records.map((r) => ({
    windowStart,
    windowEnd,
    slackUserId: r["User ID"],
    name: r.Name || null,
    username: r.Username || null,
    title: r["What I Do"] || null,
    accountType: r["Account type"] || null,
    accountCreatedAt: parseSlackDate(r["Account created (UTC)"]),
    claimedAt: parseSlackDate(r["Claimed Date (UTC)"]),
    deactivatedAt: parseSlackDate(r["Deactivated date (UTC)"]),
    daysActive: parseInteger(r["Days active"]),
    daysActiveDesktop: parseInteger(r["Days active (Desktop)"]),
    daysActiveAndroid: parseInteger(r["Days active (Android)"]),
    daysActiveIos: parseInteger(r["Days active (iOS)"]),
    messagesPosted: parseInteger(r["Messages posted"]),
    messagesPostedInChannels: parseInteger(r["Messages posted in channels"]),
    reactionsAdded: parseInteger(r["Reactions added"]),
    lastActiveAt: parseSlackDate(r["Last active (UTC)"]),
    lastActiveDesktopAt: parseSlackDate(r["Last active (Desktop) (UTC)"]),
    lastActiveAndroidAt: parseSlackDate(r["Last active (Android) (UTC)"]),
    lastActiveIosAt: parseSlackDate(r["Last active (iOS) (UTC)"]),
  }));

  // Insert in chunks to keep parameter count well under Postgres's 65535 limit
  // (22 cols × 500 rows = 11,000 params per chunk).
  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const result = await db
      .insert(slackMemberSnapshots)
      .values(chunk)
      .onConflictDoNothing({
        target: [
          slackMemberSnapshots.windowStart,
          slackMemberSnapshots.windowEnd,
          slackMemberSnapshots.slackUserId,
        ],
      })
      .returning({ id: slackMemberSnapshots.id });
    inserted += result.length;
  }

  console.log(
    `Inserted ${inserted} new rows (skipped ${mapped.length - inserted} duplicates).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
