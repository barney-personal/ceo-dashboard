CREATE TABLE "page_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"path" text NOT NULL,
	"hour_bucket" text NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_views_clerk_user_id_path_hour_bucket_unique" UNIQUE("clerk_user_id","path","hour_bucket")
);
--> statement-breakpoint
CREATE INDEX "page_views_viewed_at_idx" ON "page_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX "page_views_user_viewed_idx" ON "page_views" USING btree ("clerk_user_id","viewed_at");