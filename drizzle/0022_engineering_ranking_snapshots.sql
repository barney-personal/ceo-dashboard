CREATE TABLE "engineering_ranking_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" text NOT NULL,
	"methodology_version" text NOT NULL,
	"signal_window_start" timestamp with time zone NOT NULL,
	"signal_window_end" timestamp with time zone NOT NULL,
	"email_hash" text NOT NULL,
	"eligibility_status" text NOT NULL,
	"rank" integer,
	"composite_score" numeric(7, 4),
	"adjusted_percentile" numeric(7, 4),
	"raw_percentile" numeric(7, 4),
	"method_a" numeric(7, 4),
	"method_b" numeric(7, 4),
	"method_c" numeric(7, 4),
	"method_d" numeric(7, 4),
	"confidence_low" numeric(7, 4),
	"confidence_high" numeric(7, 4),
	"input_hash" text,
	"metadata" jsonb,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engineering_ranking_snapshots_natural_key" UNIQUE("snapshot_date","methodology_version","email_hash")
);
--> statement-breakpoint
CREATE INDEX "engineering_ranking_snapshots_date_version_idx" ON "engineering_ranking_snapshots" USING btree ("snapshot_date","methodology_version");--> statement-breakpoint
CREATE INDEX "engineering_ranking_snapshots_email_hash_idx" ON "engineering_ranking_snapshots" USING btree ("email_hash");