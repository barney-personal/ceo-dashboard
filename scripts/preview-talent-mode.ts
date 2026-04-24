// Preview the Talent Mode report (e9766a6cd260) — lists its queries, and for
// each query fetches a small sample of rows from the latest run to reveal the
// column schema. Writes per-query JSON samples to .context/ for inspection.
//
// Usage: doppler run -- npx tsx scripts/preview-talent-mode.ts

import * as fs from "node:fs";
import * as path from "node:path";
import {
  getReportQueries,
  getLatestRun,
  getQueryRuns,
  getQueryResultContent,
  extractQueryToken,
} from "@/lib/integrations/mode";

const REPORT_TOKEN = "e9766a6cd260";
const OUT_DIR = path.resolve(process.cwd(), ".context", "talent-preview");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Fetching queries for report ${REPORT_TOKEN} ...`);
  const queries = await getReportQueries(REPORT_TOKEN);
  console.log(`Found ${queries.length} queries:\n`);

  for (const q of queries) {
    console.log(`  • ${q.name}  (token=${q.token})`);
  }

  const latestRun = await getLatestRun(REPORT_TOKEN);
  if (!latestRun) {
    console.log("No latest run available — aborting sample fetch.");
    return;
  }
  console.log(`\nLatest run: ${latestRun.token} (${latestRun.state})`);

  const queryRuns = await getQueryRuns(REPORT_TOKEN, latestRun.token);
  const runByQueryToken = new Map<string, (typeof queryRuns)[number]>();
  for (const qr of queryRuns) runByQueryToken.set(extractQueryToken(qr), qr);

  for (const q of queries) {
    const qr = runByQueryToken.get(q.token);
    if (!qr) {
      console.log(`\n[skip] ${q.name}: no query_run`);
      continue;
    }
    try {
      const { rows } = await getQueryResultContent(
        REPORT_TOKEN,
        latestRun.token,
        qr.token,
        20,
      );
      const safeName = q.name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
      const outPath = path.join(OUT_DIR, `${safeName}.json`);
      const payload = {
        query_name: q.name,
        query_token: q.token,
        row_count: rows.length,
        columns: rows[0] ? Object.keys(rows[0]) : [],
        sample: rows,
      };
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
      console.log(
        `\n[ok] ${q.name} — ${rows.length} rows, ${payload.columns.length} cols → ${outPath}`,
      );
      console.log(`     columns: [${payload.columns.join(", ")}]`);
    } catch (err) {
      console.log(`\n[err] ${q.name}: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. Samples in ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
