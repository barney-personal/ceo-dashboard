import postgres, { type Sql } from "postgres";

type TableCount = {
  table: string;
  count: number;
};

type LatestSync = {
  source: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsSynced: number;
};

type ModeQuerySummary = {
  section: string;
  category: string | null;
  reportName: string;
  queryName: string;
  rowCount: number;
  syncedAt: string;
};

type PeopleSnapshot = {
  present: boolean;
  rowCount: number;
  syncedAt: string | null;
  activeCleoRows: number;
  employedRows: number;
  terminatedRows: number;
  statusCounts: Array<{ status: string; count: number }>;
  topDepartments: Array<{ department: string; count: number }>;
};

type Snapshot = {
  label: string;
  tableCounts: TableCount[];
  latestSyncs: LatestSync[];
  modeQueries: ModeQuerySummary[];
  people: PeopleSnapshot;
};

type Options = {
  leftLabel: string;
  rightLabel: string;
  leftUrl: string;
  rightUrl: string;
  section: string | null;
  json: boolean;
};

const DEFAULT_TABLES = [
  "mode_reports",
  "mode_report_data",
  "okr_updates",
  "financial_periods",
  "squads",
  "sync_log",
] as const;

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(rawKey, next);
      i += 1;
      continue;
    }

    args.set(rawKey, true);
  }

  const leftUrl =
    stringArg(args, "left-url") ??
    process.env.LEFT_DATABASE_URL ??
    process.env.DATABASE_URL;
  const rightUrl =
    stringArg(args, "right-url") ?? process.env.RIGHT_DATABASE_URL;

  if (!leftUrl || !rightUrl) {
    console.error(
      [
        "Usage: npm run db:compare -- --right-url <database-url> [options]",
        "",
        "Options:",
        "  --left-url <url>       Defaults to DATABASE_URL / LEFT_DATABASE_URL",
        "  --right-url <url>      Or set RIGHT_DATABASE_URL",
        "  --left-name <label>    Defaults to 'left'",
        "  --right-name <label>   Defaults to 'right'",
        "  --section <name>       Focus Mode query comparison on one section (default: people)",
        "  --json                 Output JSON instead of text",
      ].join("\n")
    );
    process.exit(1);
  }

  const section = stringArg(args, "section");

  return {
    leftUrl,
    rightUrl,
    leftLabel: stringArg(args, "left-name") ?? "left",
    rightLabel: stringArg(args, "right-name") ?? "right",
    section: section === "all" ? null : section ?? "people",
    json: Boolean(args.get("json")),
  };
}

function stringArg(
  args: Map<string, string | boolean>,
  key: string
): string | null {
  const value = args.get(key);
  return typeof value === "string" ? value : null;
}

function createClient(url: string): Sql {
  const hostname = safeHostname(url);
  return postgres(url, {
    max: 1,
    prepare: false,
    ssl:
      hostname === "localhost" || hostname === "127.0.0.1"
        ? false
        : "require",
  });
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchSnapshot(label: string, sql: Sql, section: string | null) {
  const [tableCounts, latestSyncs, modeQueries, people] = await Promise.all([
    fetchTableCounts(sql),
    fetchLatestSyncs(sql),
    fetchModeQueries(sql, section),
    fetchPeopleSnapshot(sql),
  ]);

  return {
    label,
    tableCounts,
    latestSyncs,
    modeQueries,
    people,
  } satisfies Snapshot;
}

async function fetchTableCounts(sql: Sql): Promise<TableCount[]> {
  const counts = await Promise.all(
    DEFAULT_TABLES.map(async (table) => {
      const rows = await sql.unsafe<{ count: string }[]>(
        `select count(*)::text as count from "${table}"`
      );
      return {
        table,
        count: Number(rows[0]?.count ?? "0"),
      };
    })
  );

  return counts;
}

async function fetchLatestSyncs(sql: Sql): Promise<LatestSync[]> {
  const rows = await sql<LatestSync[]>`
    select distinct on (source)
      source,
      status,
      started_at::text as "startedAt",
      completed_at::text as "completedAt",
      records_synced as "recordsSynced"
    from sync_log
    order by source, started_at desc
  `;

  return rows;
}

async function fetchModeQueries(
  sql: Sql,
  section: string | null
): Promise<ModeQuerySummary[]> {
  const rows = await sql<ModeQuerySummary[]>`
    select
      mr.section,
      mr.category,
      mr.name as "reportName",
      mrd.query_name as "queryName",
      mrd.row_count as "rowCount",
      mrd.synced_at::text as "syncedAt"
    from mode_report_data mrd
    inner join mode_reports mr on mr.id = mrd.report_id
    where ${section ? sql`mr.section = ${section}` : sql`true`}
    order by mr.section, mr.category, mr.name, mrd.query_name
  `;

  return rows;
}

async function fetchPeopleSnapshot(sql: Sql): Promise<PeopleSnapshot> {
  const latestRows = await sql<
    Array<{ rowCount: number; syncedAt: string | null; data: unknown[] }>
  >`
    select
      mrd.row_count as "rowCount",
      mrd.synced_at::text as "syncedAt",
      mrd.data
    from mode_report_data mrd
    inner join mode_reports mr on mr.id = mrd.report_id
    where mr.section = 'people'
      and mr.category = 'headcount'
      and mrd.query_name = 'headcount'
    order by mrd.synced_at desc
    limit 1
  `;

  const latest = latestRows[0];
  if (!latest) {
    return {
      present: false,
      rowCount: 0,
      syncedAt: null,
      activeCleoRows: 0,
      employedRows: 0,
      terminatedRows: 0,
      statusCounts: [],
      topDepartments: [],
    };
  }

  const aggregateRows = await sql<
    Array<{
      activeCleoRows: number;
      employedRows: number;
      terminatedRows: number;
    }>
  >`
    with latest as (
      select data
      from mode_report_data mrd
      inner join mode_reports mr on mr.id = mrd.report_id
      where mr.section = 'people'
        and mr.category = 'headcount'
        and mrd.query_name = 'headcount'
      order by mrd.synced_at desc
      limit 1
    )
    select
      count(*) filter (
        where lower(coalesce(row->>'lifecycle_status', '')) = 'employed'
          and lower(coalesce(row->>'is_cleo_headcount', '')) in ('1', 'true', 'yes')
      )::int as "activeCleoRows",
      count(*) filter (
        where lower(coalesce(row->>'lifecycle_status', '')) = 'employed'
      )::int as "employedRows",
      count(*) filter (
        where lower(coalesce(row->>'lifecycle_status', '')) = 'terminated'
      )::int as "terminatedRows"
    from latest, jsonb_array_elements(latest.data) as row
  `;

  const statusCounts = await sql<Array<{ status: string; count: number }>>`
    with latest as (
      select data
      from mode_report_data mrd
      inner join mode_reports mr on mr.id = mrd.report_id
      where mr.section = 'people'
        and mr.category = 'headcount'
        and mrd.query_name = 'headcount'
      order by mrd.synced_at desc
      limit 1
    )
    select
      lower(coalesce(row->>'lifecycle_status', 'unknown')) as status,
      count(*)::int as count
    from latest, jsonb_array_elements(latest.data) as row
    group by 1
    order by 2 desc, 1 asc
    limit 8
  `;

  const topDepartments = await sql<
    Array<{ department: string; count: number }>
  >`
    with latest as (
      select data
      from mode_report_data mrd
      inner join mode_reports mr on mr.id = mrd.report_id
      where mr.section = 'people'
        and mr.category = 'headcount'
        and mrd.query_name = 'headcount'
      order by mrd.synced_at desc
      limit 1
    )
    select
      coalesce(row->>'hb_function', 'Unknown') as department,
      count(*)::int as count
    from latest, jsonb_array_elements(latest.data) as row
    where lower(coalesce(row->>'lifecycle_status', '')) = 'employed'
      and lower(coalesce(row->>'is_cleo_headcount', '')) in ('1', 'true', 'yes')
    group by 1
    order by 2 desc, 1 asc
    limit 10
  `;

  return {
    present: true,
    rowCount: latest.rowCount,
    syncedAt: latest.syncedAt,
    activeCleoRows: aggregateRows[0]?.activeCleoRows ?? 0,
    employedRows: aggregateRows[0]?.employedRows ?? 0,
    terminatedRows: aggregateRows[0]?.terminatedRows ?? 0,
    statusCounts,
    topDepartments,
  };
}

function formatSnapshot(left: Snapshot, right: Snapshot, section: string | null) {
  const lines: string[] = [];

  lines.push(`Comparing ${left.label} -> ${right.label}`);
  lines.push(`Mode query focus: ${section ?? "all sections"}`);
  lines.push("");
  lines.push("Table counts");
  lines.push(formatCountRows(left.tableCounts, right.tableCounts));
  lines.push("");
  lines.push("Latest syncs");
  lines.push(formatLatestSyncRows(left.latestSyncs, right.latestSyncs));
  lines.push("");
  lines.push("Mode query differences");
  lines.push(formatModeQueryDiffs(left.modeQueries, right.modeQueries));
  lines.push("");
  lines.push("People headcount snapshot");
  lines.push(formatPeopleSnapshot(left.people, right.people, left.label, right.label));

  return lines.join("\n");
}

function formatCountRows(left: TableCount[], right: TableCount[]) {
  const rightMap = new Map(right.map((row) => [row.table, row.count]));
  const lines = ["table                     left     right    diff"];

  for (const row of left) {
    const other = rightMap.get(row.table) ?? 0;
    lines.push(
      `${pad(row.table, 24)} ${pad(String(row.count), 8)} ${pad(String(other), 8)} ${formatDelta(row.count - other)}`
    );
  }

  return lines.join("\n");
}

function formatLatestSyncRows(left: LatestSync[], right: LatestSync[]) {
  const rightMap = new Map(right.map((row) => [row.source, row]));
  const lines = ["source                    left                                 right"];

  for (const row of left) {
    const other = rightMap.get(row.source);
    lines.push(
      `${pad(row.source, 24)} ${pad(describeSync(row), 36)} ${describeSync(other)}`
    );
  }

  return lines.join("\n");
}

function describeSync(row: LatestSync | undefined): string {
  if (!row) return "missing";
  const at = row.completedAt ?? row.startedAt ?? "n/a";
  return `${row.status} @ ${at} (${row.recordsSynced} rec)`;
}

function formatModeQueryDiffs(left: ModeQuerySummary[], right: ModeQuerySummary[]) {
  const rightMap = new Map(right.map((row) => [queryKey(row), row]));
  const keys = new Set<string>([
    ...left.map(queryKey),
    ...right.map(queryKey),
  ]);

  const rows: string[] = [
    "query                                                          left rows / synced               right rows / synced",
  ];

  for (const key of [...keys].sort()) {
    const leftRow = left.find((row) => queryKey(row) === key);
    const rightRow = rightMap.get(key);

    const leftLabel = leftRow
      ? `${leftRow.rowCount} @ ${leftRow.syncedAt}`
      : "missing";
    const rightLabel = rightRow
      ? `${rightRow.rowCount} @ ${rightRow.syncedAt}`
      : "missing";

    if (leftLabel === rightLabel) {
      continue;
    }

    rows.push(`${pad(key, 62)} ${pad(leftLabel, 32)} ${rightLabel}`);
  }

  return rows.length === 1
    ? `${rows[0]}\n(no differences)`
    : rows.join("\n");
}

function queryKey(row: ModeQuerySummary): string {
  return [
    row.section,
    row.category ?? "uncategorized",
    row.reportName,
    row.queryName,
  ].join(" / ");
}

function formatPeopleSnapshot(
  left: PeopleSnapshot,
  right: PeopleSnapshot,
  leftLabel: string,
  rightLabel: string
) {
  const lines = [
    `metric                    ${pad(leftLabel, 12)} ${rightLabel}`,
    `present                   ${pad(String(left.present), 12)} ${String(right.present)}`,
    `rowCount                  ${pad(String(left.rowCount), 12)} ${String(right.rowCount)}`,
    `syncedAt                  ${pad(left.syncedAt ?? "n/a", 12)} ${right.syncedAt ?? "n/a"}`,
    `activeCleoRows            ${pad(String(left.activeCleoRows), 12)} ${String(right.activeCleoRows)}`,
    `employedRows              ${pad(String(left.employedRows), 12)} ${String(right.employedRows)}`,
    `terminatedRows            ${pad(String(left.terminatedRows), 12)} ${String(right.terminatedRows)}`,
    "",
    `${leftLabel} top statuses: ${formatPairs(left.statusCounts.map((row) => [row.status, row.count]))}`,
    `${rightLabel} top statuses: ${formatPairs(right.statusCounts.map((row) => [row.status, row.count]))}`,
    `${leftLabel} top departments: ${formatPairs(left.topDepartments.map((row) => [row.department, row.count]))}`,
    `${rightLabel} top departments: ${formatPairs(right.topDepartments.map((row) => [row.department, row.count]))}`,
  ];

  return lines.join("\n");
}

function formatPairs(pairs: Array<[string, number]>) {
  if (pairs.length === 0) return "none";
  return pairs.map(([label, count]) => `${label}:${count}`).join(", ");
}

function formatDelta(delta: number) {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : String(delta);
}

function pad(value: string, width: number) {
  return value.length >= width ? value : value.padEnd(width, " ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const leftClient = createClient(options.leftUrl);
  const rightClient = createClient(options.rightUrl);

  try {
    const [left, right] = await Promise.all([
      fetchSnapshot(options.leftLabel, leftClient, options.section),
      fetchSnapshot(options.rightLabel, rightClient, options.section),
    ]);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            left,
            right,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(formatSnapshot(left, right, options.section));
  } finally {
    await Promise.all([
      leftClient.end({ timeout: 5 }).catch(() => undefined),
      rightClient.end({ timeout: 5 }).catch(() => undefined),
    ]);
  }
}

main().catch((error) => {
  console.error("Database comparison failed");
  console.error(error);
  process.exit(1);
});
