ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "trigger" text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "worker_id" text;
--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "skip_reason" text;
--> statement-breakpoint
ALTER TABLE "sync_log" ALTER COLUMN "status" SET DEFAULT 'queued';
--> statement-breakpoint
ALTER TABLE "mode_report_data" ADD COLUMN IF NOT EXISTS "source_row_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mode_report_data" ADD COLUMN IF NOT EXISTS "stored_row_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mode_report_data" ADD COLUMN IF NOT EXISTS "truncated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mode_report_data" ADD COLUMN IF NOT EXISTS "storage_window" jsonb;
--> statement-breakpoint
UPDATE "mode_report_data"
SET
  "source_row_count" = COALESCE("source_row_count", "row_count", 0),
  "stored_row_count" = COALESCE("stored_row_count", "row_count", 0),
  "truncated" = COALESCE("truncated", false);
--> statement-breakpoint
UPDATE "sync_log"
SET
  "status" = 'error',
  "completed_at" = COALESCE("completed_at", NOW()),
  "skip_reason" = COALESCE("skip_reason", 'abandoned'),
  "error_message" = CASE
    WHEN "error_message" IS NULL OR "error_message" = '' THEN 'Lease protection migration reconciled an unfinished active run.'
    ELSE "error_message" || E'\nLease protection migration reconciled an unfinished active run.'
  END
WHERE "status" = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mode_report_data_report_synced_idx" ON "mode_report_data" ("report_id","synced_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_log_source_started_idx" ON "sync_log" ("source","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_log_source_completed_idx" ON "sync_log" ("source","completed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_log_active_source_idx" ON "sync_log" ("source") WHERE "status" in ('queued', 'running');
