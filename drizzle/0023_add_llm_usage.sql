CREATE TABLE "llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"source" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_date_source_uniq" UNIQUE("date","source")
);
--> statement-breakpoint
CREATE INDEX "llm_usage_date_idx" ON "llm_usage" USING btree ("date");