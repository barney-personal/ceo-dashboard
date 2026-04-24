CREATE TABLE "pr_review_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"merge_sha" text,
	"author_login" text NOT NULL,
	"merged_at" timestamp NOT NULL,
	"complexity" integer NOT NULL,
	"quality" integer NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"caveats" jsonb NOT NULL,
	"standout" text,
	"rubric_version" text NOT NULL,
	"raw_json" jsonb NOT NULL,
	"analysed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pr_review_analyses_repo_pr_number_rubric_version_unique" UNIQUE("repo","pr_number","rubric_version")
);
--> statement-breakpoint
CREATE INDEX "pr_review_merged_at_idx" ON "pr_review_analyses" USING btree ("merged_at");--> statement-breakpoint
CREATE INDEX "pr_review_author_idx" ON "pr_review_analyses" USING btree ("author_login");