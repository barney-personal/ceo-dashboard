ALTER TABLE "meeting_notes" ADD COLUMN "synced_by_user_id" text;
-- Mark all existing notes as pending so they are hidden until the next sync
-- backfills correct ownership. Without this, personal notes would be visible
-- to all users during the window between migration and first sync.
UPDATE "meeting_notes" SET "synced_by_user_id" = '_pending';
