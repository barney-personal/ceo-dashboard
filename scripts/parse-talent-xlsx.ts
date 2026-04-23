// Parse a Talent team xlsx export and dump rows so we can see the truth about
// who's on the Talent team right now.
//
// Usage: doppler run -- npx tsx scripts/parse-talent-xlsx.ts <path-to-xlsx>

import * as XLSX from "xlsx";

const path = process.argv[2];
if (!path) {
  console.error(
    "Usage: npx tsx scripts/parse-talent-xlsx.ts <path-to-xlsx>\n" +
      "(point it at the latest Talent roster export — e.g. Lucy's monthly file)",
  );
  process.exit(1);
}

const wb = XLSX.readFile(path);
console.log("Sheet names:", wb.SheetNames);

for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  console.log(`\n=== ${name} — ${rows.length} rows ===`);
  if (rows.length > 0) {
    console.log("columns:", Object.keys(rows[0]));
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
  }
}
