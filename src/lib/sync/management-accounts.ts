import { db } from "@/lib/db";
import { financialPeriods } from "@/lib/db/schema";
import {
  downloadSlackFile,
  listChannelFiles,
} from "@/lib/integrations/slack-files";
import {
  extractPeriodFromFilename,
  parseManagementAccounts,
} from "@/lib/integrations/excel-parser";
import { getChannelHistory } from "@/lib/integrations/slack";
import { eq } from "drizzle-orm";
import { createPhaseTracker } from "./phase-tracker";
import { SyncCancelledError } from "./errors";
import { determineSyncStatus } from "./coordinator";

const MGMT_ACCOUNTS_CHANNEL = "C036J68MTJ5"; // #fyi-management_accounts

/**
 * Find the Slack message associated with a file upload.
 * The message contains the summary commentary.
 */
async function findFileMessage(
  channelId: string,
  fileTimestamp: number
): Promise<string | null> {
  const oldest = String(fileTimestamp - 3600);
  const latest = String(fileTimestamp + 7200);
  const messages = await getChannelHistory(channelId, oldest, latest);

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
  opts: { shouldStop?: () => boolean } = {}
): Promise<{
  status: "success" | "partial" | "error" | "cancelled";
  recordsSynced: number;
  errors: string[];
}> {
  const tracker = createPhaseTracker(run.id);
  let count = 0;
  const errors: string[] = [];

  try {
    let phaseId = await tracker.startPhase(
      "list_files",
      "Fetching files from Slack channel"
    );
    const files = await listChannelFiles(MGMT_ACCOUNTS_CHANNEL, {
      types: "all",
      count: 20,
    });
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
      if (opts.shouldStop?.()) {
        throw new SyncCancelledError(
          "Management accounts sync cancelled between files"
        );
      }

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
        const buffer = await downloadSlackFile(file.url_private_download);
        const data = await parseManagementAccounts(buffer, file.name);

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
          file.timestamp
        );

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
        console.log(`Synced management accounts: ${file.name} → ${period}`);
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

        const message = `Failed to sync ${file.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        errors.push(message);
        console.error(message);
        await tracker.endPhase(filePhaseId, {
          status: "error",
          errorMessage: message,
        });
      }
    }

    return {
      status: determineSyncStatus(errors, count),
      recordsSynced: count,
      errors,
    };
  } catch (error) {
    if (error instanceof SyncCancelledError) {
      return {
        status: "cancelled",
        recordsSynced: count,
        errors: [...errors, error.message],
      };
    }

    throw error;
  }
}
