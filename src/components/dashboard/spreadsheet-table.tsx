"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface SpreadsheetTableProps {
  sheets: Record<string, unknown[][]>;
  sheetNames: string[];
  defaultSheet?: string;
}

const SUMMARY_KEYWORDS = [
  "total revenue",
  "total income",
  "gross profit",
  "contribution profit",
  "ebitda",
  "net income",
  "net profit",
  "total cost of sales",
  "total operating",
  "operating profit",
  "cash position",
  "total",
];

const SECTION_KEYWORDS = [
  "income",
  "less cost of sales",
  "less cost of risk",
  "less operating expenses",
  "marketing",
  "people",
  "other",
];

function isSummaryRow(row: unknown[]): boolean {
  const label = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  return SUMMARY_KEYWORDS.some((kw) => label.startsWith(kw));
}

function isSectionHeader(row: unknown[]): boolean {
  const label = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  const nonNullCells = row.filter((c) => c !== null && c !== "").length;
  return (
    nonNullCells <= 2 && SECTION_KEYWORDS.some((kw) => label.startsWith(kw))
  );
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((c) => c === null || String(c).trim() === "");
}

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCell(value: unknown): { display: string; isNegative: boolean; isPercent: boolean; isNumber: boolean } {
  if (value === null || value === undefined || value === "") {
    return { display: "", isNegative: false, isPercent: false, isNumber: false };
  }

  if (typeof value === "number") {
    // Heuristic: values between -2 and 2 (exclusive) that aren't whole numbers are likely percentages
    const looksLikePercent =
      Math.abs(value) <= 2 && value !== 0 && !Number.isInteger(value);

    if (looksLikePercent) {
      return {
        display: percentFormatter.format(value),
        isNegative: value < 0,
        isPercent: true,
        isNumber: true,
      };
    }

    return {
      display: numberFormatter.format(value),
      isNegative: value < 0,
      isPercent: false,
      isNumber: true,
    };
  }

  const str = String(value).trim();
  return { display: str, isNegative: false, isPercent: false, isNumber: false };
}

function isExcelDate(value: unknown): boolean {
  return typeof value === "number" && value > 40000 && value < 55000;
}

function isDateRow(row: unknown[]): boolean {
  const nonNull = row.filter((c) => c !== null && c !== "");
  if (nonNull.length === 0) return false;
  const dateCount = nonNull.filter((c) => isExcelDate(c)).length;
  return dateCount >= 3 && dateCount >= nonNull.length * 0.7;
}

function isHeaderRow(row: unknown[], rowIndex: number): boolean {
  if (rowIndex > 6) return false;
  const nonNull = row.filter((c) => c !== null && c !== "");
  if (nonNull.length === 0) return false;
  if (isDateRow(row)) return true;
  const hasNumbers = nonNull.some((c) => typeof c === "number");
  return !hasNumbers;
}

// Convert Excel serial date to month label (UTC to avoid timezone drift)
function excelDateToLabel(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function SpreadsheetTable({
  sheets,
  sheetNames,
  defaultSheet,
}: SpreadsheetTableProps) {
  const [activeSheet, setActiveSheet] = useState(defaultSheet ?? sheetNames[0]);
  const rows = sheets[activeSheet] ?? [];

  return (
    <div className="space-y-0">
      {/* Tab bar */}
      <div className="flex gap-0 overflow-x-auto border-b border-border/50">
        {sheetNames.map((name) => (
          <button
            key={name}
            onClick={() => setActiveSheet(name)}
            className={cn(
              "whitespace-nowrap px-4 py-2.5 text-xs font-medium transition-colors",
              activeSheet === name
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {rows.map((row, i) => {
              if (isEmptyRow(row)) {
                return (
                  <tr key={i}>
                    <td colSpan={row.length} className="h-3" />
                  </tr>
                );
              }

              const summary = isSummaryRow(row);
              const sectionHeader = isSectionHeader(row);
              const header = isHeaderRow(row, i);

              return (
                <tr
                  key={i}
                  className={cn(
                    summary && "bg-primary/[0.03]",
                    sectionHeader && "border-t border-border/30"
                  )}
                >
                  {row.map((cell, j) => {
                    const { display, isNegative, isNumber } = formatCell(cell);

                    // Convert Excel serial dates in header rows
                    let label = display;
                    if (header && isExcelDate(cell)) {
                      label = excelDateToLabel(cell as number);
                    }

                    // First two columns are labels (sticky first col)
                    const isLabel = j < 2;

                    return (
                      <td
                        key={j}
                        className={cn(
                          "px-2 py-1 whitespace-nowrap",
                          j === 0 && "sticky left-0 z-10 bg-card min-w-[180px]",
                          j === 1 && "min-w-[80px] text-muted-foreground",
                          isLabel && !header && "text-left",
                          !isLabel && "text-right",
                          isNumber && !isLabel && "font-mono tabular-nums",
                          isNegative && "text-destructive",
                          summary && "font-semibold",
                          sectionHeader && "font-semibold text-muted-foreground uppercase tracking-wide text-[10px] pt-3",
                          header && "font-medium text-muted-foreground border-b border-border/30 pb-1.5",
                        )}
                      >
                        {header ? label : display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
