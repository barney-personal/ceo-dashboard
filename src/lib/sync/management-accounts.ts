import { db } from "@/lib/db";
import { financialPeriods } from "@/lib/db/schema";
import {
  downloadSlackFile,
  listChannelFiles,
} from "@/lib/integrations/slack-files";
import type { FinancialData } from "@/lib/integrations/excel-parser";
import {
  extractPeriodFromFilename,
  parseManagementAccounts,
} from "@/lib/integrations/excel-parser";
import {
  checkSlackHealth,
  getChannelHistory,
} from "@/lib/integrations/slack";
import { eq } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  type SyncControl,
  throwIfSyncShouldStop,
} from "./errors";
import { determineSyncStatus, formatSyncError } from "./coordinator";
import * as Sentry from "@sentry/nextjs";

const MGMT_ACCOUNTS_CHANNEL = "C036J68MTJ5"; // #fyi-management_accounts

const MANAGEMENT_ACCOUNT_NUMERIC_FIELDS = [
  "revenue",
  "grossProfit",
  "grossMargin",
  "contributionProfit",
  "contributionMargin",
  "ebitda",
  "ebitdaMargin",
  "netIncome",
  "cashPosition",
  "cashBurn",
  "opex",
  "headcountCost",
  "marketingCost",
] as const;

function getManagementAccountsValidationWarning(
  data: FinancialData,
): string | null {
  const allNumericFieldsNull = MANAGEMENT_ACCOUNT_NUMERIC_FIELDS.every(
    (field) => data[field] == null,
  );
  if (allNumericFieldsNull) {
    return "Skipped write because all extracted numeric fields were null";
  }

  if (data.revenue == null && data.grossProfit == null) {
    return "Skipped write because both revenue and gross profit were null";
  }

  return null;
}

/**
 * Find the Slack message associated with a file upload.
 * The message contains the summary commentary.
 */
async function findFileMessage(
  channelId: string,
  fileTimestamp: number,
  opts: SyncControl = {}
): Promise<string | null> {
  const oldest = String(fileTimestamp - 3600);
  const latest = String(fileTimestamp + 7200);
  const messages = await getChannelHistory(channelId, oldest, latest, {
    signal: opts.signal,
  });

  for (const msg of messages) {
    const msgTs = parseFloat(msg.ts);
    if (
      Math.abs(msgTs - fileTimestamp) < 7200 &&
      msg.text &&
      msg.text.length > 100
    ) {
      return msg.text;
    }
  }

  return null;
}

/**
 * Sync management accounts from Slack.
 */
export async function runManagementAccountsSync(
  run: { id: number },
  opts: SyncControl = {}
): Promise<{
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
}> {
  Sentry.setTag("sync_source", "management-accounts");
  const tracker = createPhaseTracker(run.id);
  let count = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase(
      "health_check",
      "Checking Slack API connectivity"
    );
    try {
      await checkSlackHealth({ signal: opts.signal });
    } catch (error) {
      const message = `Slack API unreachable, skipping sync: ${formatSyncError(error)}`;
      Sentry.captureMessage("Slack API unreachable, skipping sync", {
        level: "warning",
        tags: {
          sync_source: "management-accounts",
          failure_scope: "health_check",
        },
        extra: {
          runId: run.id,
          message,
        },
      });
      await tracker.endPhase(phaseId, {
        status: "error",
        detail: "Slack API unreachable, sync skipped",
        errorMessage: message,
      });
      return {
        status: "error",
        recordsSynced: 0,
        errors: [message],
      };
    }
    await tracker.endPhase(phaseId, {
      detail: "Slack API reachable",
    });

    phaseId = await tracker.startPhase(
      "list_files",
      "Fetching files from Slack channel"
    );
    const files = await listChannelFiles(MGMT_ACCOUNTS_CHANNEL, {
      types: "all",
      count: 20,
    }, { signal: opts.signal });
    await tracker.endPhase(phaseId, {
      itemsProcessed: files.length,
      detail: `Found ${files.length} files in channel`,
    });

    phaseId = await tracker.startPhase(
      "filter_files",
      "Filtering for management accounts xlsx"
    );
    const mgmtFiles = files.filter(
      (file) =>
        file.name.toLowerCase().includes("management accounts") &&
        file.filetype === "xlsx"
    );
    await tracker.endPhase(phaseId, {
      itemsProcessed: mgmtFiles.length,
      detail: `Filtered to ${mgmtFiles.length} management accounts files`,
    });

    for (const file of mgmtFiles) {
      throwIfSyncShouldStop(opts, {
        cancelled: "Management accounts sync cancelled between files",
        deadlineExceeded:
          "Management accounts sync exceeded its execution budget between files",
      });

      const filePhaseId = await tracker.startPhase(
        `sync_file:${file.name}`,
        "Downloading and parsing"
      );

      try {
        const existing = await db
          .select()
          .from(financialPeriods)
          .where(eq(financialPeriods.slackFileId, file.id))
          .limit(1);

        if (existing.length > 0) {
          await tracker.endPhase(filePhaseId, {
            status: "skipped",
            detail: "Already synced",
          });
          continue;
        }

        const periodFromName = extractPeriodFromFilename(file.name);
        const buffer = await downloadSlackFile(file.url_private_download, {
          signal: opts.signal,
        });
        const data = await parseManagementAccounts(buffer, file.name, {
          signal: opts.signal,
        });

        if (!data) {
          const skipMsg = "LLM extraction returned invalid data (logged to Sentry)";
          errors.push(`Skipped ${file.name}: ${skipMsg}`);
          await tracker.endPhase(filePhaseId, {
            status: "skipped",
            detail: skipMsg,
          });
          continue;
        }

        const period = data.period || periodFromName;
        if (!period) {
          const skipMsg = "Could not determine period from filename or LLM";
          errors.push(`Skipped ${file.name}: ${skipMsg}`);
          await tracker.endPhase(filePhaseId, {
            status: "skipped",
            detail: skipMsg,
          });
          continue;
        }

        const periodLabel =
          data.periodLabel ||
          new Date(`${period}-01`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          });

        const slackSummary = await findFileMessage(
          MGMT_ACCOUNTS_CHANNEL,
          file.timestamp,
          opts
        );
        const validationWarning = getManagementAccountsValidationWarning(data);
        if (validationWarning) {
          Sentry.captureMessage(validationWarning, {
            level: "warning",
            tags: {
              sync_source: "management-accounts",
              failure_scope: "validation",
            },
            extra: {
              runId: run.id,
              filename: file.name,
              period,
            },
          });
          await tracker.endPhase(filePhaseId, {
            status: "partial",
            detail: `${validationWarning} — ${period}`,
          });
          continue;
        }

        await db
          .insert(financialPeriods)
          .values({
            period,
            periodLabel,
            slackFileId: file.id,
            filename: file.name,
            revenue: data.revenue?.toString() ?? null,
            grossProfit: data.grossProfit?.toString() ?? null,
            grossMargin: data.grossMargin?.toString() ?? null,
            contributionProfit: data.contributionProfit?.toString() ?? null,
            contributionMargin: data.contributionMargin?.toString() ?? null,
            ebitda: data.ebitda?.toString() ?? null,
            ebitdaMargin: data.ebitdaMargin?.toString() ?? null,
            netIncome: data.netIncome?.toString() ?? null,
            cashPosition: data.cashPosition?.toString() ?? null,
            cashBurn: data.cashBurn?.toString() ?? null,
            opex: data.opex?.toString() ?? null,
            headcountCost: data.headcountCost?.toString() ?? null,
            marketingCost: data.marketingCost?.toString() ?? null,
            rawData: data.rawSheets,
            slackSummary,
            postedAt: new Date(file.timestamp * 1000),
          })
          .onConflictDoUpdate({
            target: financialPeriods.period,
            set: {
              slackFileId: file.id,
              filename: file.name,
              revenue: data.revenue?.toString() ?? null,
              grossProfit: data.grossProfit?.toString() ?? null,
              grossMargin: data.grossMargin?.toString() ?? null,
              contributionProfit: data.contributionProfit?.toString() ?? null,
              contributionMargin: data.contributionMargin?.toString() ?? null,
              ebitda: data.ebitda?.toString() ?? null,
              ebitdaMargin: data.ebitdaMargin?.toString() ?? null,
              netIncome: data.netIncome?.toString() ?? null,
              cashPosition: data.cashPosition?.toString() ?? null,
              cashBurn: data.cashBurn?.toString() ?? null,
              opex: data.opex?.toString() ?? null,
              headcountCost: data.headcountCost?.toString() ?? null,
              marketingCost: data.marketingCost?.toString() ?? null,
              rawData: data.rawSheets,
              slackSummary,
              syncedAt: new Date(),
            },
          });

        count++;
        await tracker.endPhase(filePhaseId, { detail: `Synced → ${period}` });
      } catch (error) {
        if (error instanceof SyncCancelledError) {
          await tracker.endPhase(filePhaseId, {
            status: "skipped",
            detail: "Cancelled before file completed",
            errorMessage: error.message,
          });
          throw error;
        }

        if (error instanceof SyncDeadlineExceededError) {
          await tracker.endPhase(filePhaseId, {
            status: "error",
            detail: "Execution budget exceeded before file completed",
            errorMessage: error.message,
          });
          throw error;
        }

        const message = `Failed to sync ${file.name}: ${formatSyncError(error)}`;
        errors.push(message);
        await tracker.endPhase(filePhaseId, {
          status: "error",
          errorMessage: message,
        });
      }
    }

    const status = determineSyncStatus(errors, count);
    return { status, recordsSynced: count, errors };
  } catch (error) {
    if (error instanceof SyncDeadlineExceededError) {
      return {
        status: count > 0 ? "partial" : "error",
        recordsSynced: count,
        errors: [...errors, error.message],
      };
    }

    if (error instanceof SyncCancelledError) {
      return {
        status: "cancelled",
        recordsSynced: count,
        errors: [...errors, error.message],
      };
    }

    Sentry.captureException(error, {
      tags: {
        sync_source: "management-accounts",
        failure_scope: "run",
      },
      extra: {
        runId: run.id,
        recordsSynced: count,
      },
    });
    throw error;
  }
}
