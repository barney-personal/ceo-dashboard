CREATE TABLE "github_commits" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"sha" text NOT NULL,
	"author_login" text NOT NULL,
	"author_avatar_url" text,
	"committed_at" timestamp NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"message" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_commits_repo_sha_unique" UNIQUE("repo","sha")
);
--> statement-breakpoint
CREATE INDEX "github_commits_committed_at_idx" ON "github_commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX "github_commits_author_idx" ON "github_commits" USING btree ("author_login");