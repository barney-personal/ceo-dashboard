// Parse the xlsx Lucy sent and dump rows so we can see the truth about who's
// on the Talent team right now.

import * as XLSX from "xlsx";

const path =
  "/Users/barneyhussey-yeo/conductor/workspaces/ceo-dashboard-v3/irvine/.context/attachments/Talent Team Dec-April .xlsx";

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
