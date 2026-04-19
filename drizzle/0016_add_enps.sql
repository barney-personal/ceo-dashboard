CREATE TABLE "enps_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"month" text NOT NULL,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"last_shown_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "enps_prompts_user_month_uniq" UNIQUE("clerk_user_id","month")
);
--> statement-breakpoint
CREATE TABLE "enps_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"month" text NOT NULL,
	"score" integer NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "enps_responses_user_month_uniq" UNIQUE("clerk_user_id","month")
);
--> statement-breakpoint
CREATE INDEX "enps_responses_month_idx" ON "enps_responses" USING btree ("month");--> statement-breakpoint
CREATE INDEX "enps_responses_created_idx" ON "enps_responses" USING btree ("created_at");