CREATE TABLE "probe_heartbeats" (
	"probe_id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"version" text
);
--> statement-breakpoint
CREATE TABLE "probe_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_name" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probe_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"probe_id" text NOT NULL,
	"check_name" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"details_json" jsonb,
	"run_id" text,
	"target" text DEFAULT 'prod' NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "probe_runs_check_name_ts_idx" ON "probe_runs" USING btree ("check_name","ts");