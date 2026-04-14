import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export interface CheckResult {
  checkName: string;
  status: "green" | "red" | "timeout";
  latencyMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface ProbeReport {
  suite: string;
  target: string;
  startedAt: Date;
  finishedAt: Date;
  results: CheckResult[];
  gitSha: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestamp(d: Date): string {
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
    "-",
    pad2(d.getHours()),
    pad2(d.getMinutes()),
    pad2(d.getSeconds()),
  ].join("");
}

function durationStr(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${pad2(rem)}s`;
}

function statusIcon(status: CheckResult["status"]): string {
  switch (status) {
    case "green":
      return "\u2705";
    case "red":
      return "\u274C";
    case "timeout":
      return "\u23F0";
  }
}

export function renderMarkdown(report: ProbeReport): string {
  const passed = report.results.filter((r) => r.status === "green").length;
  const total = report.results.length;
  const elapsed = report.finishedAt.getTime() - report.startedAt.getTime();

  const lines: string[] = [
    `# Probe Report: ${report.suite}`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| Target | ${report.target} |`,
    `| Started | ${report.startedAt.toISOString()} |`,
    `| Duration | ${durationStr(elapsed)} |`,
    `| Result | ${passed}/${total} passed |`,
    `| Git SHA | \`${report.gitSha.slice(0, 7)}\` |`,
    "",
    "## Checks",
    "",
    "| Status | Check | Latency |",
    "|--------|-------|---------|",
  ];

  for (const r of report.results) {
    lines.push(
      `| ${statusIcon(r.status)} | ${r.checkName} | ${r.latencyMs}ms |`
    );
  }

  const failures = report.results.filter((r) => r.status !== "green");
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const f of failures) {
      lines.push(`### ${f.checkName}`);
      lines.push("");
      if (f.error) lines.push(`**Error:** ${f.error}`);
      if (f.details)
        lines.push(
          "```json",
          JSON.stringify(f.details, null, 2),
          "```"
        );
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

export function writeReport(
  report: ProbeReport,
  reportsDir: string
): string {
  mkdirSync(reportsDir, { recursive: true });
  const filename = `${formatTimestamp(report.startedAt)}-${report.gitSha.slice(0, 7)}.md`;
  const filepath = join(reportsDir, filename);
  writeFileSync(filepath, renderMarkdown(report), "utf-8");
  return filepath;
}
