import { db } from "@/lib/db";
import { financialPeriods, syncLog } from "@/lib/db/schema";
import { listChannelFiles, downloadSlackFile } from "@/lib/integrations/slack-files";
import {
  parseManagementAccounts,
  extractPeriodFromFilename,
} from "@/lib/integrations/excel-parser";
import { getChannelHistory } from "@/lib/integrations/slack";
import { eq } from "drizzle-orm";

const MGMT_ACCOUNTS_CHANNEL = "C036J68MTJ5"; // #fyi-management_accounts

/**
 * Find the Slack message associated with a file upload.
 * The message contains the summary commentary.
 */
async function findFileMessage(
  channelId: string,
  fileTimestamp: number
): Promise<string | null> {
  // Search around the file upload time
  const oldest = String(fileTimestamp - 3600); // 1 hour before
  const messages = await getChannelHistory(channelId, oldest);

  // Find message that mentions "management accounts" near the file time
  for (const msg of messages) {
    const msgTs = parseFloat(msg.ts);
    if (
      Math.abs(msgTs - fileTimestamp) < 7200 && // Within 2 hours
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
 * Finds new Excel files, downloads, parses, and stores.
 */
export async function syncManagementAccounts(): Promise<{
  status: "success" | "error";
  recordsSynced: number;
  errors: string[];
}> {
  const [log] = await db
    .insert(syncLog)
    .values({ source: "management-accounts" })
    .returning();

  try {
    // List xlsx files in the channel
    const files = await listChannelFiles(MGMT_ACCOUNTS_CHANNEL, {
      types: "all",
      count: 20,
    });

    // Filter to management accounts xlsx files
    const mgmtFiles = files.filter(
      (f) =>
        f.name.toLowerCase().includes("management accounts") &&
        f.filetype === "xlsx"
    );

    let count = 0;
    const errors: string[] = [];

    for (const file of mgmtFiles) {
      try {
        // Check if already synced
        const existing = await db
          .select()
          .from(financialPeriods)
          .where(eq(financialPeriods.slackFileId, file.id))
          .limit(1);

        if (existing.length > 0) continue; // Already synced

        // Extract period from filename
        const periodFromName = extractPeriodFromFilename(file.name);

        // Download the file
        const buffer = await downloadSlackFile(file.url_private_download);

        // Parse with LLM
        const data = await parseManagementAccounts(buffer, file.name);

        // Use filename period if LLM didn't extract one
        const period = data.period || periodFromName || "unknown";
        const periodLabel =
          data.periodLabel ||
          new Date(period + "-01").toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          });

        // Get the Slack message summary
        const slackSummary = await findFileMessage(
          MGMT_ACCOUNTS_CHANNEL,
          file.timestamp
        );

        // Upsert to DB
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
      } catch (err) {
        const message = `Failed to sync ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        console.error(message);
      }
    }

    const status = errors.length === 0 ? "success" : "error";

    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status,
        recordsSynced: count,
        errorMessage: errors.length > 0 ? errors.join("\n") : null,
      })
      .where(eq(syncLog.id, log.id));

    return { status, recordsSynced: count, errors };
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncLog.id, log.id));

    throw err;
  }
}
