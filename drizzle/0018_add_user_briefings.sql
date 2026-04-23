CREATE TABLE "user_briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"briefing_date" text NOT NULL,
	"briefing_text" text NOT NULL,
	"context_json" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_creation_tokens" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_briefings_email_date_uniq" UNIQUE("user_email","briefing_date")
);
--> statement-breakpoint
CREATE INDEX "user_briefings_date_idx" ON "user_briefings" USING btree ("briefing_date");
