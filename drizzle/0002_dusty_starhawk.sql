CREATE TABLE "meeting_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"granola_meeting_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"transcript" text,
	"action_items" jsonb,
	"participants" jsonb,
	"meeting_date" timestamp NOT NULL,
	"duration_minutes" integer,
	"calendar_event_id" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_notes_granola_meeting_id_unique" UNIQUE("granola_meeting_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_event_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"location" text,
	"organizer" text,
	"attendees" jsonb,
	"recurring_event_id" text,
	"html_link" text,
	"calendar_id" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_calendar_event_id_calendar_id_unique" UNIQUE("calendar_event_id","calendar_id")
);
--> statement-breakpoint
CREATE TABLE "pre_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"slack_ts" text NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"title" text,
	"content" text,
	"attachments" jsonb,
	"meeting_date" timestamp,
	"posted_at" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pre_reads_slack_ts_channel_id_unique" UNIQUE("slack_ts","channel_id")
);
--> statement-breakpoint
CREATE INDEX "meeting_notes_date_idx" ON "meeting_notes" USING btree ("meeting_date");--> statement-breakpoint
CREATE INDEX "meetings_start_time_idx" ON "meetings" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "pre_reads_posted_at_idx" ON "pre_reads" USING btree ("posted_at");