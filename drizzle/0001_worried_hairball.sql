CREATE TABLE "debug_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"data" jsonb,
	"sync_run_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
