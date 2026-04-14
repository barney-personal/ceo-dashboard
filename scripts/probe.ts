/**
 * Probe CLI — runs production probes and writes markdown reports.
 *
 * Usage:
 *   npx tsx scripts/probe.ts <suite-or-check> [--target=prod|staging] [--dry-run]
 *   npx tsx scripts/probe.ts ceo-15m-suite
 *   npx tsx scripts/probe.ts ceo-ping-auth
 *   npx tsx scripts/probe.ts --all
 */
import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { execSync } from "child_process";
import { parse as parseYaml } from "yaml";
import { signPayload } from "@/lib/probes/hmac";
import type { CheckResult, ProbeReport, DeliveryFailure } from "./probes/report";
import { writeReport } from "./probes/report";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestCheck {
  description: string;
  handler: string;
  timeout_ms: number;
  tags?: string[];
}

interface ManifestSuite {
  description: string;
  checks: string[];
}

interface Manifest {
  suites: Record<string, ManifestSuite>;
  checks: Record<string, ManifestCheck>;
}

export interface CheckContext {
  target: string;
  probeSecret: string;
  baseUrl: string;
  sign: (payload: string) => { signature: string; ts: number };
}

export type CheckHandler = (ctx: CheckContext) => Promise<CheckResult>;

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

const MANIFEST_PATH = resolve(dirname(new URL(import.meta.url).pathname), "probes/manifest.yaml");

export function loadManifest(path: string = MANIFEST_PATH): Manifest {
  const raw = readFileSync(path, "utf-8");
  const doc = parseYaml(raw) as Manifest;
  if (!doc.checks || !doc.suites) {
    throw new Error("Invalid manifest: missing 'checks' or 'suites' key");
  }
  return doc;
}

export function resolveChecks(
  manifest: Manifest,
  nameOrSuite: string
): string[] {
  if (nameOrSuite === "--all") {
    return Object.keys(manifest.checks);
  }
  if (manifest.suites[nameOrSuite]) {
    return manifest.suites[nameOrSuite].checks;
  }
  if (manifest.checks[nameOrSuite]) {
    return [nameOrSuite];
  }
  throw new Error(
    `Unknown check or suite: "${nameOrSuite}". Available: ${[
      ...Object.keys(manifest.suites),
      ...Object.keys(manifest.checks),
    ].join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// Summary name — normalize the CLI arg for the final machine-readable line
// ---------------------------------------------------------------------------

export function formatSummaryName(nameArg: string): string {
  return nameArg === "--all" ? "probe-all" : nameArg;
}

// ---------------------------------------------------------------------------
// Git SHA — static command with no user input, safe to use execSync
// ---------------------------------------------------------------------------

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------

async function runCheck(
  checkName: string,
  def: ManifestCheck,
  ctx: CheckContext
): Promise<CheckResult> {
  const handlerPath = resolve(dirname(MANIFEST_PATH), def.handler);
  const start = performance.now();

  try {
    const mod = (await import(handlerPath)) as { default?: CheckHandler; run?: CheckHandler };
    const handler = mod.run ?? mod.default;
    if (!handler) {
      throw new Error(`Handler at ${def.handler} must export 'run' or 'default'`);
    }

    const result = await Promise.race([
      handler(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), def.timeout_ms)
      ),
    ]);

    return result;
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "timeout" ? "timeout" : "red";
    return { checkName, status, latencyMs, error: message };
  }
}

// ---------------------------------------------------------------------------
// Report posting (to control plane)
// ---------------------------------------------------------------------------

export type DeliveryResult =
  | { ok: true }
  | { ok: false; error: string };

export async function postResult(
  result: CheckResult,
  ctx: CheckContext,
  runId: string
): Promise<DeliveryResult> {
  const payload = JSON.stringify({
    probeId: "cloud-cron",
    checkName: result.checkName,
    status: result.status,
    latencyMs: result.latencyMs,
    details: result.details,
    runId,
    target: ctx.target,
  });

  const { signature, ts } = ctx.sign(payload);

  try {
    const res = await fetch(`${ctx.baseUrl}/api/probes/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Probe-Signature": signature,
        "X-Probe-Timestamp": String(ts),
      },
      body: payload,
    });
    if (!res.ok) {
      const error = `${res.status} ${res.statusText}`;
      console.error(`  [report] POST failed: ${error}`);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  [report] POST error: ${error}`);
    return { ok: false, error };
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/probe.ts <suite-or-check> [options]

Arguments:
  <suite-or-check>   A suite name, check name, or --all

Options:
  --target=<env>     Target environment (default: prod)
  --dry-run          Write report but skip posting results
  --help             Show this help`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const target =
    args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "prod";
  const dryRun = args.includes("--dry-run");
  const nameArg = args.find((a) => !a.startsWith("--")) ?? "--all";

  const manifest = loadManifest();
  const checkNames = resolveChecks(manifest, nameArg);

  const probeSecret = process.env.PROBE_SECRET ?? "";
  const baseUrl =
    process.env.CEO_DASHBOARD_URL ?? "https://ceo-dashboard.onrender.com";

  if (!probeSecret && !dryRun) {
    console.warn(
      "Warning: PROBE_SECRET not set — result posting will fail auth"
    );
  }

  const ctx: CheckContext = {
    target,
    probeSecret,
    baseUrl,
    sign: (payload: string) => signPayload(payload, probeSecret),
  };

  const gitSha = getGitSha();
  const runId = `${Date.now()}-${gitSha}`;
  const startedAt = new Date();
  const results: CheckResult[] = [];
  const deliveryFailures: DeliveryFailure[] = [];

  console.log(
    `\nProbe run: ${nameArg} | target=${target} | sha=${gitSha}${dryRun ? " | DRY RUN" : ""}\n`
  );

  for (const name of checkNames) {
    const def = manifest.checks[name];
    if (!def) {
      console.error(`\u274C ${name}: not found in manifest`);
      results.push({
        checkName: name,
        status: "red",
        latencyMs: 0,
        error: "not found in manifest",
      });
      continue;
    }

    process.stdout.write(`\uD83D\uDD04 ${name} ...`);
    const result = await runCheck(name, def, ctx);
    results.push(result);

    const icon = result.status === "green" ? "\u2705" : result.status === "timeout" ? "\u23F0" : "\u274C";
    console.log(`\r${icon} ${name} ${result.latencyMs}ms`);

    if (!dryRun) {
      const delivery = await postResult(result, ctx, runId);
      if (!delivery.ok) {
        deliveryFailures.push({ checkName: name, error: delivery.error });
        console.error(`  \u26A0\uFE0F ${name}: delivery failed — ${delivery.error}`);
      }
    }
  }

  const finishedAt = new Date();
  const report: ProbeReport = {
    suite: nameArg,
    target,
    startedAt,
    finishedAt,
    results,
    gitSha,
    deliveryFailures: deliveryFailures.length > 0 ? deliveryFailures : undefined,
  };

  const reportsDir = resolve(
    dirname(new URL(import.meta.url).pathname),
    "../.probe-reports"
  );
  const reportPath = writeReport(report, reportsDir);

  const passed = results.filter((r) => r.status === "green").length;
  const total = results.length;
  const elapsed = finishedAt.getTime() - startedAt.getTime();
  const elapsedStr =
    elapsed < 60000
      ? `${Math.round(elapsed / 1000)}s`
      : `${Math.floor(elapsed / 60000)}m${String(Math.round((elapsed % 60000) / 1000)).padStart(2, "0")}s`;

  const allGreen = passed === total;
  const hasDeliveryFailures = deliveryFailures.length > 0;
  const summaryName = formatSummaryName(nameArg);

  if (hasDeliveryFailures) {
    console.log(
      `\n\u26A0\uFE0F ${summaryName}: ${deliveryFailures.length} delivery failure(s) — results not ingested`
    );
  }

  const ok = allGreen && !hasDeliveryFailures;
  const exitIcon = ok ? "\u2705" : "\u274C";
  console.log(
    `\n${exitIcon} ${summaryName}: ${passed}/${total} passed in ${elapsedStr} | report: ${reportPath}\n`
  );

  process.exit(ok ? 0 : 1);
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
