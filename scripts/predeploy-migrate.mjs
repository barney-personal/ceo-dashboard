#!/usr/bin/env node

import { spawn } from "node:child_process";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[predeploy] DATABASE_URL is required");
  process.exit(1);
}

const readinessAttempts = Number.parseInt(
  process.env.MIGRATION_DB_READY_ATTEMPTS ?? "30",
  10
);
const readinessDelayMs = Number.parseInt(
  process.env.MIGRATION_DB_READY_DELAY_MS ?? "10000",
  10
);
const migrationAttempts = Number.parseInt(
  process.env.MIGRATION_ATTEMPTS ?? "3",
  10
);
const migrationDelayMs = Number.parseInt(
  process.env.MIGRATION_RETRY_DELAY_MS ?? "15000",
  10
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

async function waitForDatabase() {
  for (let attempt = 1; attempt <= readinessAttempts; attempt += 1) {
    const sql = postgres(databaseUrl, {
      max: 1,
      ssl: process.env.NODE_ENV === "production" ? "require" : false,
      connect_timeout: 5,
      idle_timeout: 5,
    });

    try {
      await sql`select 1`;
      await sql.end({ timeout: 5 });
      console.log(
        `[predeploy] database ready (attempt ${attempt}/${readinessAttempts})`
      );
      return;
    } catch (error) {
      try {
        await sql.end({ timeout: 5 });
      } catch {
        // Best effort shutdown for failed probe connections.
      }

      const message = formatError(error);
      console.warn(
        `[predeploy] database unavailable (attempt ${attempt}/${readinessAttempts}): ${message}`
      );

      if (attempt === readinessAttempts) {
        throw new Error(
          `database was not ready after ${readinessAttempts} attempts`
        );
      }

      await sleep(readinessDelayMs);
    }
  }
}

function runDrizzleMigrate() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["drizzle-kit", "migrate"], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`drizzle-kit migrate exited with code ${code ?? "unknown"}`)
      );
    });
  });
}

async function main() {
  await waitForDatabase();

  for (let attempt = 1; attempt <= migrationAttempts; attempt += 1) {
    try {
      console.log(
        `[predeploy] running drizzle migrations (attempt ${attempt}/${migrationAttempts})`
      );
      await runDrizzleMigrate();
      console.log("[predeploy] migrations complete");
      return;
    } catch (error) {
      const message = formatError(error);
      console.warn(
        `[predeploy] migration attempt ${attempt}/${migrationAttempts} failed: ${message}`
      );

      if (attempt === migrationAttempts) {
        throw error;
      }

      await sleep(migrationDelayMs);
      await waitForDatabase();
    }
  }
}

main().catch((error) => {
  console.error("[predeploy] migration failed", error);
  process.exit(1);
});
