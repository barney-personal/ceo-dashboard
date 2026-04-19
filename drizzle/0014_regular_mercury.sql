CREATE TABLE "slack_member_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"slack_user_id" text NOT NULL,
	"name" text,
	"username" text,
	"title" text,
	"account_type" text,
	"account_created_at" timestamp,
	"claimed_at" timestamp,
	"deactivated_at" timestamp,
	"days_active" integer DEFAULT 0 NOT NULL,
	"days_active_desktop" integer DEFAULT 0 NOT NULL,
	"days_active_android" integer DEFAULT 0 NOT NULL,
	"days_active_ios" integer DEFAULT 0 NOT NULL,
	"messages_posted" integer DEFAULT 0 NOT NULL,
	"messages_posted_in_channels" integer DEFAULT 0 NOT NULL,
	"reactions_added" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"last_active_desktop_at" timestamp,
	"last_active_android_at" timestamp,
	"last_active_ios_at" timestamp,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_member_snapshot_window_user_uniq" UNIQUE("window_start","window_end","slack_user_id")
);
--> statement-breakpoint
CREATE INDEX "slack_member_snapshots_window_idx" ON "slack_member_snapshots" USING btree ("window_start","window_end");
