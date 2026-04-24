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
import { db } from "@/lib/db";
import { userIntegrations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  UserIntegrationTokenKeyError,
  encryptUserIntegrationToken,
  isEncryptedToken,
} from "@/lib/security/user-integration-tokens.server";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Fail early if the key isn't set — encryptUserIntegrationToken() will
  // throw on first use otherwise, but we want a clean operator-facing message.
  try {
    encryptUserIntegrationToken("probe");
  } catch (err) {
    if (err instanceof UserIntegrationTokenKeyError) {
      console.error(`[reencrypt] aborting: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const rows = await db
    .select({
      id: userIntegrations.id,
      clerkUserId: userIntegrations.clerkUserId,
      provider: userIntegrations.provider,
      apiKey: userIntegrations.apiKey,
    })
    .from(userIntegrations);

  let alreadyEncrypted = 0;
  let willReencrypt = 0;
  let reencryptFailed = 0;

  for (const row of rows) {
    if (isEncryptedToken(row.apiKey)) {
      alreadyEncrypted++;
      continue;
    }

    willReencrypt++;
    const shortId = row.clerkUserId.slice(-6);
    const preview = `${row.provider} / user ...${shortId} (id=${row.id})`;

    if (dryRun) {
      console.log(`[reencrypt] DRY would encrypt ${preview}`);
      continue;
    }

    try {
      const envelope = encryptUserIntegrationToken(row.apiKey);
      await db
        .update(userIntegrations)
        .set({ apiKey: envelope, updatedAt: new Date() })
        .where(eq(userIntegrations.id, row.id));
      console.log(`[reencrypt] encrypted ${preview}`);
    } catch (err) {
      reencryptFailed++;
      console.error(`[reencrypt] FAILED ${preview}: ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log("[reencrypt] summary");
  console.log(`  total rows:         ${rows.length}`);
  console.log(`  already encrypted:  ${alreadyEncrypted}`);
  console.log(`  needed re-encrypt:  ${willReencrypt}`);
  console.log(`  dry run:            ${dryRun ? "yes" : "no"}`);
  if (!dryRun) {
    console.log(`  re-encrypt failed:  ${reencryptFailed}`);
  }

  // Exit code: 0 on success, 1 if any row failed in a real run.
  process.exit(!dryRun && reencryptFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[reencrypt] unexpected error:", err);
  process.exit(2);
});
