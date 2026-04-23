// Extract the HC Forecast sheet(s) from the spreadsheet so we can
// compare the team's attrition numbers with ours.
// Usage: doppler run -- npx tsx scripts/parse-hc-forecast.ts <xlsx-path>

import * as XLSX from "xlsx";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/parse-hc-forecast.ts <xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(path);

const targetSheets = [
  "HC Forecast",
  "HC Forecast - update",
  "Summary (Latest)",
];

for (const name of wb.SheetNames) {
  if (!targetSheets.some((t) => name.includes(t.split(" ")[0]))) continue;
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    header: 1,
  });
  console.log(`\n=== ${name} — ${rows.length} rows ===`);
  // Print all non-empty rows as tuples
  rows.forEach((row, i) => {
    const vals = Object.values(row).map((v) =>
      v == null ? "" : typeof v === "number" ? String(v) : String(v).slice(0, 40),
    );
    if (vals.some((v) => v !== "")) {
      console.log(`  ${i.toString().padStart(3)} | ${vals.join(" | ")}`);
    }
  });
}
