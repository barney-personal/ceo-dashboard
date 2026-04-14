CREATE TABLE "github_pr_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"prs_count" integer DEFAULT 0 NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"repos" jsonb NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pr_metrics_login_period_start_period_end_unique" UNIQUE("login","period_start","period_end")
);
--> statement-breakpoint
CREATE INDEX "github_pr_metrics_period_idx" ON "github_pr_metrics" USING btree ("period_start","period_end");