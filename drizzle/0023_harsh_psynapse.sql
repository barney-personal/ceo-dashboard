ALTER TABLE "slack_employee_map" ADD COLUMN "slack_image_url" text;--> statement-breakpoint
ALTER TABLE "slack_employee_map" ADD COLUMN "slack_image_fetched_at" timestamp;
