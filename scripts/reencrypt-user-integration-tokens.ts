/**
 * One-off migration: re-encrypt plaintext `user_integrations.api_key` rows
 * in place using the AES-256-GCM envelope scheme.
 *
 * Usage:
 *
 *     # Dry run — shows what would change, writes nothing.
 *     doppler run -- npx tsx scripts/reencrypt-user-integration-tokens.ts --dry-run
 *
 *     # Real run.
 *     doppler run -- npx tsx scripts/reencrypt-user-integration-tokens.ts
 *
 * The script refuses to run if `USER_INTEGRATIONS_ENCRYPTION_KEY` is not set
 * or is malformed, and skips rows that are already in envelope format so it
 * is safe to run more than once.
 */
import { db as defaultDb } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  UserIntegrationTokenKeyError,
  encryptUserIntegrationToken,
  isEncryptedToken,
} from "@/lib/security/user-integration-tokens.server";

export type ReencryptSummary = {
  total: number;
  alreadyEncrypted: number;
  reencrypted: number;
  failed: number;
  dryRun: boolean;
};

type DbClient = typeof defaultDb;

/**
 * Re-encrypt any plaintext rows in `user_integrations.api_key`.
 * Throws `UserIntegrationTokenKeyError` (before any DB writes) if the
 * encryption key is missing or malformed. Uses the provided `db` client
 * so the script is testable without real Postgres.
 */
export async function reencryptUserIntegrationTokens(opts: {
  dryRun?: boolean;
  db?: DbClient;
  logger?: Pick<Console, "log" | "error">;
} = {}): Promise<ReencryptSummary> {
  const { dryRun = false, db = defaultDb, logger = console } = opts;

  // Key probe — fails early with a clean operator-facing message before any
  // writes and before we even enumerate rows.
  encryptUserIntegrationToken("probe");

  const rows = await db
    .select({
      id: userIntegrations.id,
      clerkUserId: userIntegrations.clerkUserId,
      provider: userIntegrations.provider,
      apiKey: userIntegrations.apiKey,
    })
    .from(userIntegrations);

  let alreadyEncrypted = 0;
  let reencrypted = 0;
  let failed = 0;

  for (const row of rows) {
    if (isEncryptedToken(row.apiKey)) {
      alreadyEncrypted++;
      continue;
    }

    const shortId = row.clerkUserId.slice(-6);
    const preview = `${row.provider} / user ...${shortId} (id=${row.id})`;

    if (dryRun) {
      logger.log(`[reencrypt] DRY would encrypt ${preview}`);
      continue;
    }

    try {
      const envelope = encryptUserIntegrationToken(row.apiKey);
      await db
        .update(userIntegrations)
        .set({ apiKey: envelope, updatedAt: new Date() })
        .where(eq(userIntegrations.id, row.id));
      logger.log(`[reencrypt] encrypted ${preview}`);
      reencrypted++;
    } catch (err) {
      failed++;
      logger.error(
        `[reencrypt] FAILED ${preview}: ${(err as Error).message}`
      );
    }
  }

  return { total: rows.length, alreadyEncrypted, reencrypted, failed, dryRun };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  let summary: ReencryptSummary;
  try {
    summary = await reencryptUserIntegrationTokens({ dryRun });
  } catch (err) {
    if (err instanceof UserIntegrationTokenKeyError) {
      console.error(`[reencrypt] aborting: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  console.log("");
  console.log("[reencrypt] summary");
  console.log(`  total rows:         ${summary.total}`);
  console.log(`  already encrypted:  ${summary.alreadyEncrypted}`);
  console.log(`  needed re-encrypt:  ${summary.reencrypted + summary.failed + (summary.dryRun ? summary.total - summary.alreadyEncrypted : 0)}`);
  console.log(`  dry run:            ${summary.dryRun ? "yes" : "no"}`);
  if (!summary.dryRun) {
    console.log(`  re-encrypted:       ${summary.reencrypted}`);
    console.log(`  re-encrypt failed:  ${summary.failed}`);
  }

  process.exit(!summary.dryRun && summary.failed > 0 ? 1 : 0);
}

// Only run the CLI when invoked directly (not when imported for tests).
// Use process.argv[1] so this works under tsx's ESM-style transform without
// needing CJS-only `require.main`.
if (process.argv[1]?.endsWith("reencrypt-user-integration-tokens.ts")) {
  main().catch((err) => {
    console.error("[reencrypt] unexpected error:", err);
    process.exit(2);
  });
}
