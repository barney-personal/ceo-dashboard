CREATE TABLE "github_prs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"author_login" text NOT NULL,
	"author_avatar_url" text,
	"merged_at" timestamp NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_prs_repo_pr_number_unique" UNIQUE("repo","pr_number")
);
--> statement-breakpoint
CREATE INDEX "github_prs_merged_at_idx" ON "github_prs" USING btree ("merged_at");--> statement-breakpoint
CREATE INDEX "github_prs_author_idx" ON "github_prs" USING btree ("author_login");