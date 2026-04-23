CREATE TABLE "headcount_forecast_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"as_of_month" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"starting_headcount" integer NOT NULL,
	"hire_scenarios" jsonb NOT NULL,
	"attrition_rates" jsonb NOT NULL,
	"projection" jsonb NOT NULL,
	CONSTRAINT "headcount_forecast_snapshot_month_uniq" UNIQUE("as_of_month")
);
--> statement-breakpoint
CREATE INDEX "headcount_forecast_snapshot_captured_idx" ON "headcount_forecast_snapshots" USING btree ("captured_at");